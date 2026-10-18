// Combined wasm imports env.emo_process_block. Smokes that instantiate with {}
// get a no-op here. The live worklet passes the real callback.
const emoInstantiate = WebAssembly.instantiate.bind(WebAssembly);
const EmoInstance = WebAssembly.Instance;

function emoImports(imports) {
  const base = imports && typeof imports === "object" ? imports : {};
  const env = Object.assign({}, base.env);
  if (typeof env.emo_process_block !== "function") {
    env.emo_process_block = function emoProcessBlock() {};
  }
  return Object.assign({}, base, { env });
}

WebAssembly.instantiate = function emoInstantiateWithImport(source, imports) {
  return emoInstantiate(source, emoImports(imports));
};

function EmoInstanceWithImport(module, imports) {
  return new EmoInstance(module, emoImports(imports));
}
EmoInstanceWithImport.prototype = EmoInstance.prototype;
WebAssembly.Instance = EmoInstanceWithImport;
