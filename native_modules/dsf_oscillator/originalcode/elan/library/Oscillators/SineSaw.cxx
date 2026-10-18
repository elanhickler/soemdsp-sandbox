/*
Extended DSF Algorithms by Walter H. Hackett IV
- Engineer's Square to Sine

Antialiased oscillator that is able to morph from sine to square
with a smooth harmonic falloff.
*/

#include "../math.cxx"

class SineSaw
{
    SineSaw() {}

    double sampleRate = 0;
    double frequency = 0;
    double phase = 0;
    double phaseOffset = 0;
    double output = 0;
    double morph = 0;
    double value = 0;

    void reset()
    {
        phase = 0;
        leak = 1;
    }

    void setPhase(double v)
    {
        phase = v;
    }

    void setPhaseOffset(double v)
    {
        phaseOffset = v;
    }

    void setSampleRate(double v)
    {
        sampleRate = v;
        update();
    }

    void setFrequency(double v)
    {
        frequency = v;
        update();
    }

    // -1 to 1, 0 being sine, 1 being remp, -1 being saw
    void setMorph(double v)
    {
        morphBipolar = v;
        morph = abs(v);
        
        k = (1.0 - pow(morph,.14)) * 4.0;
        k2 = k * k;
        k42 = pow(4,k2);
    }

    double getSample()
    {        
        phase += increment * 0.9999; // added 0.9999 to help prevent errors
        phase = phase - floor(phase);

        x = (phase + phaseOffset) * TAU;

        leak = leak * 0.99 + 0.000005;
        value = value * (1.0-leak) + sinSawDSF() * increment;
        
        lastValue = value;
        
        return -value * 2;
    }

    protected void update()
    {
        increment = frequency / sampleRate;
        double maxPartials = frequency == 0.0 ? 1.0 : (sampleRate * 0.5) / frequency;
        n = max(floor(maxPartials), 1);
    }

    protected double sinSawDSF()
    {
        double xn = x*n;
        double cosx = cos(x);
        double cosxn = cos(xn);

        return (morphBipolar < 0 ? -1 : 1) * ((k42*cosxn-pow(8,k2)*(cosxn*cosx-sin(xn)*sin(x)))*pow(2,-k2*(n+1))+cosx*k42-pow(2,k2))/(1-pow(2,1+k2)*cosx+k42);
    }

    protected double leak = 1.0;
    protected double increment = 0;
    protected double lastValue = 0;
    protected double n = 0; // number of partials
    protected double k = 0;
    protected double k2 = 0;
    protected double k42 = 0;
    protected double x = 0;
    double morphBipolar = 0;
}