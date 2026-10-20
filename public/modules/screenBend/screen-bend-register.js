// Screen Bend — bow a picture like a curved tube. Width and Height are bipolar.
registerNodeGraphChromelessModule("screenBend", {
  label: "Screen Bend",
  solidModule: false,
  customDisplayArea: true,
  definition: {
    chrome: "LayoutA",
    planRole: "monitor",
    bufferedInputs: [],
    defaultWidthGu: 8,
    displayHeightGu: 6,
    displayType: "screenBendFace",
    displayRenderer: "screenBendFace",
    displayModes: [
      {
        key: "face",
        label: "Face",
        renderer: "screenBendFace",
        settingsSchema: "screenBendFace",
      },
    ],
    defaultDisplayMode: "face",
    inputs: ["rgba"],
    inputLabels: { rgba: "📺" },
    inputTooltips: {
      rgba: "Picture in. Same shared picture context.",
    },
    outputs: ["rgba"],
    outputLabels: { rgba: "📺" },
    outputTooltips: {
      rgba: "Picture out, bowed as if on a curved screen.",
    },
    parameters: [
      {
        bipolar: true,
        defaultValue: "0.55",
        key: "width",
        label: "Width",
        linearSmoothing: false,
        max: "1",
        mid: "0",
        min: "-1",
        nonlinearSlider: false,
        step: "any",
        tooltip: "Horizontal bow. 0 is flat. Positive bows the sides outward, like a CRT. Negative bows them inward.",
      },
      {
        bipolar: true,
        defaultValue: "0.55",
        key: "height",
        label: "Height",
        linearSmoothing: false,
        max: "1",
        mid: "0",
        min: "-1",
        nonlinearSlider: false,
        step: "any",
        tooltip: "Vertical bow. 0 is flat. Positive bows the top and bottom outward. Negative bows them inward.",
      },
    ],
    visualSink: true,
  },
  catalog: {
    category: "rgba",
    description:
      "Bows a picture onto a curved screen. Width bows the sides, Height bows the top and bottom. "
      + "Positive is an outer CRT bend. Negative is an inner bend.",
    notes: ["screen bend", "crt", "curve", "barrel", "pincushion", "picture", "shader", "LayoutA"],
  },
});
