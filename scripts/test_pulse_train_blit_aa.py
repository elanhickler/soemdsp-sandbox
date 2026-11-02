"""Compile and exercise actual native DSP. Run from repository root with Python 3 and g++."""
import ctypes
import math
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[1]
INCLUDE = Path(os.environ.get('PULSE_AA_INCLUDE', ROOT/'library/include'))

class PulseTrainAA(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        binary = Path(cls.tmp.name) / 'pulse-aa.so'
        subprocess.run(['g++', '-std=c++17', '-O2', '-shared', '-fPIC', '-I', str(INCLUDE), str(ROOT/'native_modules/pulse_train/pulse_train.cpp'), '-o', str(binary)], check=True)
        cls.lib = ctypes.CDLL(str(binary))
        cls.lib.soemdsp_pulse_train_sample.argtypes = [ctypes.c_int]+[ctypes.c_double]*22
        cls.lib.soemdsp_pulse_train_sample.restype = ctypes.c_double
        cls.lib.soemdsp_pulse_train_end.restype = ctypes.c_double
    @classmethod
    def tearDownClass(cls): cls.tmp.cleanup()
    def render(self, shape, width=.25, period=5.5, count=1, loop=1, n=6600, reset=-1, change=-1, aa=3, reverse=0):
        lib=self.lib; h=lib.soemdsp_pulse_train_create(); out=[]; ends=0
        try:
            for i in range(n):
                selected = 5 if change >= 0 and i >= change else shape
                args=[1 if i in [0,reset] else 0,count,period/48000,0,1,1,0,1,48000,loop,0,0,0,aa,1,selected,0,width,0,0,0,reverse]
                out.append(lib.soemdsp_pulse_train_sample(h,*args))
                ends+=lib.soemdsp_pulse_train_end(h)
        finally: lib.soemdsp_pulse_train_destroy(h)
        return out,ends
    def mean(self, y): return sum(y[1100:])/len(y[1100:])
    def test_gate_aa(self):
        y,_=self.render(1); self.assertAlmostEqual(self.mean(y),.5,delta=.0002)
    def test_trigger_aa(self):
        y,_=self.render(0); self.assertAlmostEqual(self.mean(y),1/5.5,delta=.0002)
        self.assertTrue(any(v<-.01 for v in y)) # fractional BLIT side lobes
    def test_left_pulse_aa(self):
        y,_=self.render(6); self.assertAlmostEqual(self.mean(y),-.5,delta=.0002)
    def test_center_pulse_aa(self):
        y,_=self.render(7); self.assertAlmostEqual(self.mean(y),-.5,delta=.0002)
    def test_right_pulse_aa(self):
        y,_=self.render(8); self.assertAlmostEqual(self.mean(y),-.5,delta=.0002)
    def test_saw_aa(self):
        y,_=self.render(2); self.assertAlmostEqual(self.mean(y),0,delta=.0002)
    def test_ramp_aa(self):
        y,_=self.render(3); self.assertAlmostEqual(self.mean(y),0,delta=.0002)
    def test_unsupported_shapes_are_silent(self):
        for shape in [4,5,9]:
            with self.subTest(shape=shape):
                y,_=self.render(shape,n=500); self.assertEqual(max(map(abs,y)),0)
    def test_switch_to_sine_is_immediately_silent(self):
        y,_=self.render(6,change=101,n=500); self.assertGreater(max(map(abs,y[:101])),.1)
        self.assertEqual(max(map(abs,y[101:])),0)
    def test_dense_grains(self):
        for shape,target in [(1,.5),(2,0),(3,0),(6,-.5),(7,-.5),(8,-.5)]:
            with self.subTest(shape=shape):
                y,_=self.render(shape,period=2.5,n=6600)
                self.assertAlmostEqual(self.mean(y),target,delta=.0002)
    def test_width_extremes(self):
        for shape in [6,7,8]:
            for width,target in [(0,-1),(1,1)]:
                y,_=self.render(shape,width=width); self.assertAlmostEqual(self.mean(y),target,delta=.0002)
    def test_one_shot_tails_end(self):
        for shape in [0,1,2,3,6,7,8]:
            y,ends=self.render(shape,loop=0,count=2,period=173.25,n=500)
            self.assertEqual(ends,1); self.assertLess(max(map(abs,y[-100:])),1e-10)
    def test_resets_are_bounded(self):
        for shape in [0,1,2,3,6,7,8]:
            y,_=self.render(shape,reset=117,n=500)
            self.assertTrue(all(math.isfinite(v) and abs(v)<4 for v in y))
    def test_reverse_duty(self):
        for shape in [1,2,3,6,7,8]:
            y,_=self.render(shape,reverse=1)
            self.assertAlmostEqual(self.mean(y),.5 if shape==1 else (0 if shape in [2,3] else -.5),delta=.0002)
if __name__ == '__main__': unittest.main()
