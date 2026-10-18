"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function loadColorRowHelper() {
  const src = fs.readFileSync(path.join(PUBLIC, "node-graph-module-scope-settings-form.js"), "utf8");
  const start = src.indexOf("function nodeGraphDisplaySettingsColorRowSizes");
  const end = src.indexOf("function nodeGraphDisplaySettingsBuildToggleRowHtml");
  if (start < 0 || end < 0) fail("color row helpers missing from settings-form.js");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src.slice(start, end), sandbox);
  return sandbox;
}

function checkSizes(helper) {
  const sizes = helper.nodeGraphDisplaySettingsColorRowSizes;
  const expect = {
    1: [1],
    2: [2],
    3: [3],
    4: [4],
    5: [3, 2],
    6: [3, 3],
    7: [4, 3],
    8: [4, 4],
    9: [3, 3, 3],
    10: [4, 3, 3],
    12: [4, 4, 4],
  };
  for (const [n, want] of Object.entries(expect)) {
    const got = sizes(Number(n));
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fail(`ColorRowSizes(${n}) => ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  }
  const html = helper.nodeGraphDisplaySettingsColorRows(
    ["a", "b", "c", "d", "e"],
    [3, 2],
  );
  if (!html.includes("data-color-row-cells=\"3\"") || !html.includes("data-color-row-cells=\"2\"")) {
    fail("ColorRows did not emit 3+2 rows");
  }
  try {
    helper.nodeGraphDisplaySettingsColorRows(["a", "b", "c", "d", "e"], [[1, 2, 3, 4, 5]]);
    fail("ColorRows should throw on a group of 5");
  } catch (error) {
    if (!String(error.message || error).includes("5")) fail(String(error));
  }
}

function colorRowCount(rowHtml) {
  const n = (rowHtml.match(/type=["']color["']/gi) || []).length
    + (rowHtml.match(/data-trace-display-color-row=/g) || []).length
    + (rowHtml.match(/data-hbs-widget/g) || []).length
    + (rowHtml.match(/data-hsl-lamp=/g) || []).length
    + (rowHtml.match(/data-trace-display-color-widget=/g) || []).length;
  return n;
}

function checkHtmlPage(fileName) {
  const html = fs.readFileSync(path.join(PUBLIC, fileName), "utf8");
  const inputs = [...html.matchAll(/<input\b[^>]*type=["']color["'][^>]*>/gi)];
  if (!inputs.length) fail(`${fileName}: no color inputs`);
  for (const match of inputs) {
    const at = match.index;
    const before = html.slice(0, at);
    const rowStart = before.lastIndexOf("node-color-row");
    if (rowStart < 0) fail(`${fileName}: color input not in .node-color-row (${match[0].slice(0, 80)})`);
    const open = before.lastIndexOf("<div", rowStart);
    const close = html.indexOf("</div>", at);
    const row = html.slice(open, close + 6);
    const count = (row.match(/type=["']color["']/gi) || []).length;
    if (count < 1 || count > 4) fail(`${fileName}: color row has ${count} inputs`);
  }
}

function checkKeypadConverted() {
  const src = fs.readFileSync(path.join(PUBLIC, "modules", "keypad", "keypad-settings.js"), "utf8");
  if (!src.includes("nodeGraphDisplaySettingsColorRows")) {
    fail("keypad-settings.js still stacks colors (missing ColorRows)");
  }
}

const helper = loadColorRowHelper();
checkSizes(helper);
checkHtmlPage("index.html");
checkHtmlPage("perform.html");
checkKeypadConverted();
console.log("smoke_color_rows: ok");
