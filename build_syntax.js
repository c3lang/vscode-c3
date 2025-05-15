const { readFileSync, existsSync, mkdirSync, writeFileSync } = require("fs");
const js_yaml = require("js-yaml");

let text = readFileSync("syntaxes/c3.tmLanguage.yml").toString();

const variables = {
  "INT": '[0-9](_?[0-9])*',
  "HINT": '[a-fA-F0-9](_?[a-fA-F0-9])*',
  "OINT": '[0-7](_?[0-7])*',
  "BINT": '[0-1](_?[0-1])*',
  "INTTYPE": '(?:[ui](8|16|32|64|128)|[Uu][Ll]?|[Ll])',
  "REALTYPE": '(?:[f](8|16|32|64|128)?)',
  "E": '[Ee][+-]?[0-9]+',
  "P": '[Pp][+-]?[0-9]+',
  "CONST": '(?:_*[A-Z][_A-Z0-9]*)',
  "TYPE":  '(?:_*[A-Z][_A-Z0-9]*[a-z][_a-zA-Z0-9]*)',
  "IDENT": '(?:_*[a-z][_a-zA-Z0-9]*)',
  "keyword": 'assert|asm|catch|const|extern|tlocal|inline|import|module|interface|static|try|var',
  "control_keyword": 'break|case|continue|default|defer|do|else|for|foreach|foreach_r|if|nextcase|return|switch|while',
  "ct_keyword": 'alignof|assert|assignable|default|defined|echo|embed|eval|evaltype|error|exec|extnameof|feature|include|is_const|nameof|offsetof|qnameof|sizeof|stringify|typefrom|typeof|vacount|vatype|vaconst|vaarg|vaexpr|vasplat',
  "ct_control_keyword": 'case|else|endfor|endforeach|endif|endswitch|for|foreach|if|switch',
  "base_type": 'void|bool|char|double|float|float16|int128|ichar|int|iptr|isz|long|short|uint128|uint|ulong|uptr|ushort|usz|float128|any|anyfault|typeid',
  "attribute": 'align|benchmark|bigendian|builtin|callconv|compact|const|deprecated|dynamic|export|extern|finalizer|format|if|inline|init|link|littleendian|local|maydiscard|naked|noalias|nodiscard|noinit|noinline|nopadding|norecurse|noreturn|nosanitize|nostrip|obfuscate|operator|operator_r|operator_s|optional|overlap|packed|private|public|pure|reflect|safemacro|section|tag|test|unused|used|wasm|weak|winmain',
};

text = text.replaceAll(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, x) => variables[x]);

const json = js_yaml.load(text);
writeFileSync("syntaxes/c3.tmLanguage.json", JSON.stringify(json, null, 2));