// Compositional DSF by Walter H. Hackett IV


#include "library/Midi.hxx"
#include "library/Constants.hxx"

string name="Single Linear Segment DSF";
string description=name;
blit_saw_oscillator _blit_saw;

array<double> inputParametersDefault = {0.0,1.0,1.0,1.0};
array<double> inputParameters(4,0);
array<string> inputParametersNames={"Start Partial", "End Partial", "Height H","Height L"};

const double tau = 3.14159265358979 * 2.0;
const double cos1 = cos(1);
const double sin1 = sin(1);

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

    // constructor
    blit_saw_oscillator_note()
    {
        t = 0.0;
        value = 0.0;
        n = 0;
        dt = 0.0;
        note_no = 0;
        velocity = 0.0;
    }
};

// oscillator class
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

            //
            double freq = 440.0*(pow(2.0, (note.note_no + _pitchbend - 69.0) / 12.0));
            note.n = int(sampleRate / 2.0 / freq);
            note.dt = freq / sampleRate;

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

    double bandlimited_impulse(double t, int m)    
    {
        double x = t * tau; // remap 0.0 ... 1.0 range to 0.0 ... Tau
        double a = floor(inputParameters[0] * 1000 + 1.0); // low partials
        if (a > floor(m)) a = floor(m-2); // stop at nyquist
        double b = floor(inputParameters[1] * 1000 + 1.0); // high partials
        if (b > floor(m)) b = floor(m); // stop at nyquist
        double h = max(inputParameters[2],.3); // height h
        double l = max(inputParameters[3],.3); // height l

        //sum(cos(n*x)*(n-a)/(b-a)*(h-l)+cos(n*x)*l, n = a .. b)=
        return 0.5*(sin(x)*(l*(-b+a)*cos(x)+l+l*b-l*a-h)*cos(a*x)+sin(x)*(h*(-b+a)*cos(x)-l+h+h*b-h*a)*cos(x*b)
            +(-1+cos(x))*(cos(x)+1)*(-sin(a*x)*l+h*sin(x*b))*(-b+a))/sin(x)/(-1+cos(x))/(-b+a);
    }

    double process_sample()
    {
        double value = 0.0;
        for (uint i = 0; i < _active_note_count; ++i)
        {
            // render
            blit_saw_oscillator_note@ note = _notes[i];
            value += note.value * note.velocity;
            note.t += note.dt * 0.99997; // added 0.9999 to help prevent errors
            note.t = note.t - floor(note.t);
            note.value = note.value*0.998 + (bandlimited_impulse(note.t, note.n) )*note.dt;
            
        }
        return value;
    }
};

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

        if( _blit_saw.is_silent() )continue;

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
