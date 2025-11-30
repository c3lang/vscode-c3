const { readFileSync, writeFileSync } = require("fs");
const js_yaml = require("js-yaml");

let text = readFileSync("syntaxes/c3.tmLanguage.yml").toString();

const variables = {
  "INT": '[0-9](?:_?[0-9])*',
  "HINT": '[a-fA-F0-9](?:_?[a-fA-F0-9])*',
  "OINT": '[0-7](_?[0-7])*',
  "BINT": '[0-1](_?[0-1])*',
  "INTTYPE": '(?:[UuIi](?:8|16|32|64|128)|[Uu][Ll]{0,2}|[Ll]{1,2})',
  "REALTYPE": '(?:[Ff](?:16|32|64|128)?|[Dd])',
  "E": '[Ee][+-]?[0-9]+',
  "P": '[Pp][+-]?[0-9]+',
  "CONST": '(?:\\b_*[A-Z][_A-Z0-9]*\\b)',
  "TYPE": '(?:\\b_*[A-Z][_A-Z0-9]*[a-z][_a-zA-Z0-9]*\\b)',
  "IDENT": '(?:\\b_*[a-z][_a-zA-Z0-9]*\\b)',
  "keyword": 'assert|asm|catch|inline|import|module|interface|try|var',
  "control_keyword": 'break|case|continue|default|defer|do|else|for|foreach|foreach_r|if|nextcase|return|switch|while',
  "ct_keyword": 'alignof|assert|assignable|default|defined|echo|embed|eval|error|exec|extnameof|feature|include|is_const|kindof|nameof|offsetof|qnameof|sizeof|stringify|vacount|vaconst|vaarg|vaexpr|vasplat',
  "ct_control_keyword": 'case|else|endfor|endforeach|endif|endswitch|for|foreach|if|switch',
  "base_type": 'void|bool|char|double|float|float16|bfloat|int128|ichar|int|iptr|isz|long|short|uint128|uint|ulong|uptr|ushort|usz|float128|any|fault|typeid',
  "attribute": 'align|allow_deprecated|benchmark|bigendian|builtin|callconv|cname|compact|const|deprecated|dynamic|export|extern|finalizer|format|if|inline|init|jump|link|littleendian|local|maydiscard|naked|noalias|nodiscard|noinit|noinline|nopadding|norecurse|noreturn|nosanitize|nostrip|obfuscate|operator|operator_r|operator_s|optional|overlap|packed|private|public|pure|reflect|safeinfer|safemacro|simd|section|structlike|tag|test|unused|used|wasm|weak|winmain',
};

// Insert all the regular expression placeholders
text = text.replaceAll(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, x) => variables[x]);

// VS Code themes are inconsistent w.r.t. supporting `entity.name` and `support.type`, so we just insert both in order to get consistent colors for types with all themes
const textVscode = text
  .replace("scopeName: source.c3", "scopeName: source.vscode.c3") // Change the root scope name!
  .replaceAll("<SCOPE_NAME_TYPE_USE>", "support.type.c3 entity.name.type.c3")
  .replaceAll(/\<SCOPE_NAME_TYPE_DECL:([A-Za-z0-9_]*)\>/g, (_, x) => {
    return x ? `support.type.c3 entity.name.type.${x}.c3` : `support.type.c3 entity.name.type.c3`;
  });

// TextMate/Linguist doesn't support multiple scopes separated by whitespace
const textTextMate = text
  .replaceAll("<SCOPE_NAME_TYPE_USE>", "support.type.c3")
  .replaceAll(/\<SCOPE_NAME_TYPE_DECL:([A-Za-z0-9_]*)\>/g, (_, x) => {
    return x ? `entity.name.type.${x}.c3` : `entity.name.type.c3`;
  });


writeFileSync("syntaxes/c3.tmLanguage.json", JSON.stringify(js_yaml.load(textTextMate), null, 2));
writeFileSync("syntaxes/c3.vscode.tmLanguage.json", JSON.stringify(js_yaml.load(textVscode), null, 2));
