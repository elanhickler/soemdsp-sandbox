// phosphorLight — retired name of 2D Phosphor (scope2d).
//
// Shop: hidden. Stored patches were converted to scope2d once.
// This file only keeps the renderer registry entry so a leftover
// phosphorLight displayType still draws through the canonical energy path.

function drawNodeGraphPhosphorLightItem(renderer, item, pixelRatio) {
  if (typeof drawNodeGraphScope2dItem === "function") {
    return drawNodeGraphScope2dItem(renderer, item, pixelRatio);
  }
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.phosphorLight = drawNodeGraphPhosphorLightItem;
}
