// Extended DSF Algorithms by Walter H. Hackett IV
// - Engineer's Square to Sine 

#include "library/Midi.hxx"
#include "library/Constants.hxx"

string name="Engineer's Square to Sine ";
string description=name;
blit_saw_oscillator _blit_saw;
array<double> inputParameters(3);
array<string> inputParametersNames={"Frequency", "Morph", "On | Off"};
array<double> inputParametersMin = {0, 0, 0};
array<double> inputParametersMax = {16000, 1, 1};
array<double> inputParametersDefault = {110, 0, 1};
array<string> inputParametersUnits = {"Hz", "", ""};
array<string> inputParametersFormats={".1",".2",""};
array<string> inputParametersEnums={"", "", "On;Off"};
array<int> inputParametersSteps={0, 0, 2};

double lastval = 0.0;
double tau = PI * 2.0;
double k = 0.0;
double j = 0.0;
double value = 0.0;

// note
class blit_saw_oscillator_note
{
    // current time
    double t;

    // current value
    double value;

    // nyquist limit
    int n;

    // delta t
    double dt;

    // note number [0,127]
    int note_no;

    // velocity [0,1]
    double velocity;

    double freq;

    double leak;
    // constructor
    blit_saw_oscillator_note()
    {
        t = 0.0;
        value = 0.0;
        n = 0;
        dt = 0.0;
        note_no = 0;
        velocity = 0.0;
        freq = 0.0;
        leak = 1.0;
    }
};

class blit_saw_oscillator
{
    array<blit_saw_oscillator_note> _notes(16);
    uint _active_note_count;
    double _pitchbend;

    blit_saw_oscillator()
    {
        _active_note_count = 0;
        _pitchbend = 0.0;
    }

    void trigger(const MidiEvent& evt)
    {
        if( _active_note_count < _notes.length )
        {
            blit_saw_oscillator_note@ note = _notes[_active_note_count];

            note.note_no = MidiEventUtils::getNote(evt);
            note.velocity = MidiEventUtils::getNoteVelocity(evt)/127.0;
            note.value = 0.0;
            note.t = 0.5;

            note.leak = 0.5;
            note.freq = 440.0*(pow(2.0, (note.note_no + _pitchbend - 69.0) / 12.0));
            note.n = int(sampleRate / 2.0 / note.freq);
            note.dt = note.freq / sampleRate;

            ++_active_note_count;
        }
    }

    void update_pitchbend(const MidiEvent& evt)
    {
        _pitchbend = MidiEventUtils::getPitchWheelValue(evt)/4096.0;

        for (uint i = 0; i < _active_note_count; ++i)
        {
            blit_saw_oscillator_note@ note = _notes[i];

            double freq = 440.0*(pow(2.0, (note.note_no + _pitchbend - 69.0) / 12.0));
            note.n = int(sampleRate / 2.0 / freq);
            note.dt = freq / sampleRate;
        }
    }

    void release(const MidiEvent& evt)
    {
        int note_no = MidiEventUtils::getNote(evt);
        uint idx;
        for(idx = 0; idx < _active_note_count; ++idx)
        {
            if( idx < _active_note_count && _notes[idx].note_no == note_no )
            {
                if( idx < _active_note_count - 1)
                {
                    _notes[idx] = _notes[_active_note_count - 1];
                }

                --_active_note_count;
            }
        }
    }

    bool is_silent()
    {
        return _active_note_count == 0;
    }

    double bandlimited_impulse(blit_saw_oscillator_note@ note)
    {
        
        double x = note.t * tau; // x is phase, note.t is phase accumulator
        double maxX = (sampleRate * 0.5) / note.freq; // note.freq is frequency, maxX is number of partials to draw
        
        double n = floor(maxX * 0.5); // n is number of partials to draw
        if (n < 1.0) n = 1.0;

        return 8.0*((pow(k,n+1)*k*cos(x*(2*n-1))-pow(k,(n+1))*cos(x*(2*n+1))-k*cos(x)*(k-1))/k/(1+k*k-2*k*cos(2*x)));
    }

    double process_sample()
    {
        k = k * 0.999 + j * 0.001; // leaky integrator

        if (is_silent())
        {
            lastval *= 0.999;
            value = lastval;
        }
        else value = 0.0;

        for (uint i = 0; i < _active_note_count; ++i)
        {
            blit_saw_oscillator_note@ note = _notes[i];
            value += note.value * note.velocity;
            note.leak = note.leak * 0.99 + 0.000005; // how leaky is the leak
            note.t += note.dt * 0.9999; // added 0.9999 to help prevent errors
            note.t = note.t - floor(note.t); // make sure range is 0 to 1
            note.value = note.value * (1.0-note.leak) + bandlimited_impulse(note) * note.dt; // leak implementation
        }
        
        lastval = value;
        return value;
    }
};

void updateInputParameters()
{
    j = 1.000000000001 - (1.0/(pow(((inputParameters[0])/2+0.25),14)*10000.0+1.0)); // morph knob
}

void processBlock(BlockData& data)
{
    const MidiEvent@ event;
    if( 0 < data.inputMidiEvents.length )
    {
        @event = data.inputMidiEvents[0];
    }

    uint event_idx = 0;
    for(uint i=0; i<data.samplesToProcess; ++i)
    {
        while( @event != null && event.timeStamp <= double(i) )
        {
            MidiEventType evt_type = MidiEventUtils::getType(event);
            if( evt_type == kMidiNoteOn )
            {
                _blit_saw.trigger(event);
            }
            else if( evt_type == kMidiNoteOff )
            {
                _blit_saw.release(event);
            }
            else if( evt_type == kMidiPitchWheel )
            {
                _blit_saw.update_pitchbend(event);
            }

            ++event_idx;
            if( event_idx < data.inputMidiEvents.length )
            {
                @event = data.inputMidiEvents[event_idx];
            }
            else
            {
                @event = null;
            }
        }

        double value = _blit_saw.process_sample();
        for(uint ch = 0; ch < audioOutputsCount; ++ch)
        {
            data.samples[ch][i] = value;
        }
    }
}

int getTailSize()
{
    return -1;
}
