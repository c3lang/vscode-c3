const { readFileSync, writeFileSync } = require("fs");
const js_yaml = require("js-yaml");

let text = readFileSync("syntaxes/c3.tmLanguage.yml").toString();

// Extract variables defined in the YAML source
const variables = js_yaml.load(text).variables || {};

// Replace {{name}} variable placeholders with their regex values
text = text.replaceAll(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, name) => {
  if (name in variables) return variables[name];
  return `{{${name}}}`; // Leave scope placeholders untouched
});

// Replace {{scope:*}} placeholders differently per target.
// VS Code themes are inconsistent w.r.t. supporting `entity.name` and `support.type`,
// so the VS Code output uses both (space-separated) for consistent coloring across themes.
// TextMate/Linguist doesn't support multiple scopes separated by whitespace.
const textVscode = text
  .replace("scopeName: source.c3", "scopeName: source.vscode.c3")
  .replaceAll("{{scope:type_use}}", "support.type.c3 entity.name.type.c3")
  .replaceAll(/\{\{scope:type_decl(?::([A-Za-z0-9_]*))?\}\}/g, (_, suffix) => {
    return suffix ? `support.type.c3 entity.name.type.${suffix}.c3` : `support.type.c3 entity.name.type.c3`;
  });

const textTextMate = text
  .replaceAll("{{scope:type_use}}", "support.type.c3")
  .replaceAll(/\{\{scope:type_decl(?::([A-Za-z0-9_]*))?\}\}/g, (_, suffix) => {
    return suffix ? `entity.name.type.${suffix}.c3` : `entity.name.type.c3`;
  });

// Validate no unresolved placeholders remain
for (const [label, content] of [["TextMate", textTextMate], ["VS Code", textVscode]]) {
  const unresolved = content.match(/\{\{[^}]+\}\}/g);
  if (unresolved) {
    console.error(`WARNING: Unresolved placeholders in ${label} output:`, [...new Set(unresolved)]);
  }
}

function buildJson(text) {
  const obj = js_yaml.load(text);
  delete obj.variables; // Strip the variables section from the output
  return JSON.stringify(obj, null, 2);
}

writeFileSync("syntaxes/c3.tmLanguage.json", buildJson(textTextMate));
writeFileSync("syntaxes/c3.vscode.tmLanguage.json", buildJson(textVscode));
