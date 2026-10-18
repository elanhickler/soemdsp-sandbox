// Plugin-host boot. Loaded in <head> and again after the boot markup exists.
(function bootPluginHost() {
  var plugin = false;
  try { plugin = /(?:^|[?&])host=plugin(?:&|$)/i.test(location.search); } catch (e) {}
  if (!document.documentElement.dataset.bootPluginHost) {
    document.documentElement.dataset.bootPluginHost = "1";
    if (plugin) {
      document.documentElement.classList.add("soemdsp-plugin-host");
      var hide = document.createElement("style");
      hide.textContent = "html.soemdsp-plugin-host .node-boot-hero-title,html.soemdsp-plugin-host .node-boot-menu-links{display:none!important}";
      document.head.appendChild(hide);
    }
  }
  if (!plugin || !document.body || !document.body.classList.contains("node-boot-waiting")) return;
  document.body.classList.remove("node-boot-waiting");
  var label = document.getElementById("nodeBootLoadingLabel");
  var bar = document.getElementById("nodeBootLoadingBar");
  var messages = document.getElementById("nodeBootLoadingMessages");
  if (label) { label.hidden = false; label.textContent = "loading"; }
  if (bar) bar.hidden = false;
  if (messages) messages.hidden = false;
})();
