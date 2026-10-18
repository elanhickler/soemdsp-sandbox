// Extended DSF Algorithms by Walter H. Hackett IV
// - Engineer's Saw to Sine 

#include "library/math.cxx"
#include "library/Oscillators/SineSaw.cxx"

array<double> inputParameters(5);
array<string> inputParametersNames = {"Pitch", "Morph", "Amplitude", "Phase Offset", "Reset"};
array<double> inputParametersMin = {0, -1, 0, -10, 0};
array<double> inputParametersMax = {127, 1, 1, 10, 1};
array<double> inputParametersDefault = {30, 0, .5, 0, 0};
array<string> inputParametersUnits = {""};
array<string> inputParametersFormats = {".2",".2",".2", ".2", ".2"};
array<string> inputParametersEnums={"", "", "", "", "playing;resetting"};
array<int> inputParametersSteps={0, 0, 0, 0, 2};

string name="Engineer's Sine to Saw";
string description="oscillator that can morph from sine to saw";

SineSaw oscillator;

void initialize()
{
    oscillator.setSampleRate(sampleRate);
}

double amplitude = 0;
double output = 0;
bool doReset = false;

void updateInputParameters()
{
    oscillator.setFrequency(pitchToFrequency(inputParameters[0]));
    oscillator.setMorph(inputParameters[1]);
    amplitude = inputParameters[2];
    oscillator.setPhaseOffset(inputParameters[3]);
    doReset = inputParameters[4] != 0.0 ? true : false;
}

void processBlock(BlockData& data)
{
    for(uint i = 0; i < data.samplesToProcess; i++)
    {
        output = 0;
        if (doReset)
        {
            oscillator.reset();
        }
        else
        {
            output = oscillator.getSample() * amplitude;   

            if (audioOutputsCount >= 2)
            {
                data.samples[0][i] = output;
                data.samples[1][i] = output;
            }
            else
            {
                for(uint ch = 0; ch < audioOutputsCount; ++ch)
                    data.samples[ch][i] = output;
            }
        }
    }
}

int getTailSize()
{
    return -1;
}
