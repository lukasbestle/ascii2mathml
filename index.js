"use strict";

var lexicon = require('./lib/lexicon'),
    identifiers = lexicon.identifiers,
    operators = lexicon.operators,
    groupings = lexicon.groupings;

var syntax = require('./lib/syntax'),
    isgroupStart = syntax.isgroupStart,
    getopenType = syntax.getopenType,
    getcloseType = syntax.getcloseType,
    ismatrixInterior = syntax.ismatrixInterior;


function tag(tagname) {
  return function fn(content, attr) {
    if (typeof content === 'object') {
      // Curry
      return function(str) { return fn(str, content); };
    }
    if (typeof attr !== 'object') {
      return `<${tagname}>${content}</${tagname}>`;
    } else {
      let attrstr = Object.keys(attr).map(function(key) {
        return `${key}="${attr[key]}"`;
      }).join(" ");
      return `<${tagname} ${attrstr}>${content}</${tagname}>`;
    }
  };
}

const mi = tag("mi"),
      mn = tag("mn"),
      mo = tag("mo"),
      mfrac = tag("mfrac"),
      msup = tag("msup"),
      msub = tag("msub"),
      msubsup = tag("msubsup"),
      munder = tag("munder"),
      mover = tag("mover"),
      munderover = tag("munderover"),
      mrow = tag("mrow"),
      msqrt = tag("msqrt"),
      mroot = tag("mroot"),
      mfenced = tag("mfenced"),
      mtable = tag("mtable"),
      mtr = tag("mtr"),
      mtd = tag("mtd"),
      mtext = tag("mtext");


const rowsplit = splitby(',');
const colsplit = splitby(';');

function splitby(sep) {
  return function(str) {
    let split = [],
        inners = 0,
        index = 0;

    for (let i=0; i < str.length; i+=1) {
      let char = str[i];
      if (char === sep) {
        if (inners === 0) {
          split.push(str.slice(index, i));
          index = i+1;
        }
      }
      else if (char.match(groupings.open.regexp)) inners += 1;
      else if (char.match(groupings.close.regexp)) inners -= 1;
    }
    split.push(str.slice(index));
    return split;
  };
}


function ascii2mathml(asciimath, options) {
  options = typeof options === "object" ? options : {};
  options.annotate = options.annotate || false;
  options.bare = options.bare || false;
  options.display = options.display || "inline";
  options.standalone = options.standalone || false;

  if (options.display && options.bare) {
    throw new Error("Can't display block without root element.");
  }

  let math = options.display !== "inline" ? function(expr) {
    return `<math display="${options.display}">${expr}</math>`;
  } :
      options && options.bare ? function(x) { return x; } :
      tag("math");

  if (options.annotate) {
    // Make sure the all presentational part is the first element
    let mathml = parsegroup(asciimath.trim());
    return math("<semantics>" + mathml +
                '<annotation encoding="application/AsciiMath">' +
                asciimath +
                "</annotation>" +
                "</semantics>");
  }

  return math(parse(asciimath.trim(), ""));
}

function parse(ascii, mathml, space) {

  if (!ascii) return mathml;

  if (ascii.match(/^\s/)) {
    // Dont include the space it if there is a binary infix becoming
    // a prefix
    if (ascii.match(/^\s+(\/[^\/]|^[^\^]|_[^_|])/)) {
      return parse(ascii.trim(), mathml, true);
    }

    // Count the number of leading spaces
    let spaces = ascii.match(/^ +/),
        spacecount = spaces ? spaces[0].length : 0;
    if (spacecount > 1) {
      // spacewidth is a linear function of spacecount
      let spaceel = `<mspace width="${spacecount-1}ex" />`;
      return parse(ascii.trim(), mathml+spaceel, true);
    };

    return parse(ascii.trim(), mathml, true);
  }

  // Check for the special case of a root
  if (ascii.startsWith('sqrt')) {
    let tail = ascii.slice(4).trim();
    let split = parseone(tail[0], tail.slice(1), true),
        nextml = removeSurroundingBrackets(split[0]),
        nextascii = split[1];
    return parse(nextascii, mathml +  msqrt(nextml));

  } else if (ascii.startsWith('root')) {
    let tail = ascii.slice(4).trim();
    let one = parseone(tail[0], tail.slice(1), true),
        index = removeSurroundingBrackets(one[0]),
        tail2 = one[1].trim();
    let two = parseone(tail2[0], tail2.slice(1), true),
        base = removeSurroundingBrackets(two[0]);
    return parse(two[1], mathml + mroot(base + index));

  }


  let next = parseone(ascii[0], ascii.slice(1), false),
      head = next[0],
      rest = next[1];

  if (ascii[0] === '/' && ascii[1] !== '/') {
    // fraction
    let next = infix2prefix(mfrac, mathml, head, rest);
    return parse(next[0], next[1], false);

  } else if (ascii[0] === '^' && ascii[1] !== '^') {
    // Superscript
    // will be <msupsub> if next el is `_`
    let next = infix2prefix(msup, mathml, head, rest);
    return parse(next[0], next[1], false);

  } else if (ascii[0] === '_' && (ascii[1] !== '_' || ascii[1] !== '|')) {
    // Subscript
    // will be <msupsub> if next el is `^`
    // Will be <munder> if previous operator is one of unders
    let next = infix2prefix(msub, mathml, head, rest);
    return parse(next[0], next[1], false);

  } else if (ascii.startsWith('./') && ascii[2] !== '/') {
    // Forced bevelled fraction
    let next = infix2prefix(mfrac({bevelled: true}),
                            mathml, './', ascii.slice(2));
    return parse(next[0], next[1], false);

  } else if (ascii.startsWith('.^') && ascii[2] !== '^') {
    // Forced overscript
    let next = infix2prefix(mover, mathml, '.^', ascii.slice(2));
    return parse(next[0], next[1], false);

  } else if (ascii.startsWith('._') && !ascii[2].match(/[_|]/)) {
    // Forced overscript
    let next = infix2prefix(munder, mathml, '._', ascii.slice(2));
    return parse(next[0], next[1], false);

  } else {
    return parse(rest, mathml+head, false);
  }
}


function parsegroup(ascii) {
  // Takes one asciiMath string and returns mathml in one group
  let mathml = parse(ascii, "", false, null);
  return mathml === getlastel(mathml) ? mathml : mrow(mathml);
}


function parseone(head, tail, skipbrackets) {
  /**
   Return a split of the first element parsed to MathML and the rest
   of the string unparsed.
   */

  // TODO: split this up into smaller more readable code

  if (!head) return ["", ""];

  let ascii = head + tail;
  if (ascii.match(/^[0-9A-Za-z+\-!]{2,}([ ,;])/)) {
    // treat as a group
    let next = ascii.split(/[ ,;]/)[0];
    let ml = parsegroup(next);
    return [ml, ascii.slice(next.length)];
  }

  var expr,
      nextsymbol = head + (tail.match(/^[A-Za-z]+/) || "");


  if (isgroupStart(ascii)) {
    let split = syntax.splitNextGroup(ascii),
        open = groupings.open.get(split[1]),
        group = split[2],
        close = split[3],
        rest = groupings.open.get(split[4]);

    if (ismatrixInterior(group)) {
      let table = parsetable(group, "");
      return [mfenced(table, {open: open, close: close}), rest];
    }

    let cols = colsplit(group);
    if (cols.length > 1) {
      // A column vector
      if (cols.length === 2 && open === '(' && close ===')') {
        // Experimenting with the binomial coefficient
        // Perhaps I'll remove this later
        let binom = mfrac(cols.map(parsegroup).join(""), {
          linethickness: 0
        });
        return [mfenced(binom, {open: open, close: close}), rest];
      }
      let matrix = cols.map([mtr, mtd, parsegroup].reduce(compose)).join('');
      return [mfenced(mtable(matrix), {open: open, close: close}), rest];

    } else {
      // A fenced group
      let rows = rowsplit(group),
          els = rows.map(parsegroup).join("");
      if (!skipbrackets) els = mfenced(els, {open: open, close: close});
      else if (splitlast(els)[1] !== els) els = mrow(els);

      return [els, rest];
    }

  } else if (ascii.match(new RegExp("^" + lexicon.fonts.regexp.source + '?"'))) {
    let textobj = syntax.splittext(ascii);
    let textel = mtext(textobj.text,
                       textobj.font && {mathvariant: textobj.font});
    return [textel, textobj.rest];

  } else if (ascii.match(new RegExp(
    "^" + lexicon.fonts.regexp.source + '?`[0-9A-Za-z]+`'
  ))) {
    // Forcing an identifier
    let start = ascii.indexOf("`"),
        stop = start + 1 + ascii.slice(start+1).indexOf("`"),
        font = lexicon.fonts.get(ascii.slice(0, start));
    let miel = mi(ascii.slice(start+1, stop),
                  font && {mathvariant: font});
    return [miel, ascii.slice(stop+1)];

  } else if (head.match(/[A-Za-z]/)) {
    // Identifier?

    // Perhaps a special identifier character
    if (identifiers.contains(nextsymbol)) {
      let symbol = identifiers[nextsymbol];

      // Uppercase greeks are roman font variant
      let el = symbol.match(/[\u0391-\u03A9\u2100-\u214F\u2200-\u22FF]/) ?
            mi({mathvariant: "normal"}) : mi ;

      return [el(symbol), tail.slice(nextsymbol.length-1)];

    } else if (head === 'O' && tail[0] === '/') {
      // The special case of the empty set
      // I suppose there is no dividing by the latin capital letter O

      return [mi(identifiers["O/"], {mathvariant: "normal"}),
              tail.slice(1)];

    } else if (operators.contains(nextsymbol)) {
      // or an operator
      return [mo(operators[nextsymbol]), tail.slice(nextsymbol.length-1)];
 
    } else if (head === "o" && tail[0].match(/^[x.+]$/)) {
      // the o operators have latin heads but non-latin tails
      return [mo(operators[head+tail[0]]), tail.slice(1)];
    }

    expr = mi(head);

  } else if (head.match(/\d+/)) {
    // Number
    let number = (head+tail).match(/^\d+(\.\d+)?/)[0];
    return [mn(number), tail.slice(number.length-1)];

  } else if (head.match(operators.regexp)) {
    // Operator
    if (tail[0] && tail[0].match(operators.regexp) &&
        operators.contains(head+tail[0])) {
      return parseone(head+tail[0], tail.slice(1));
    }
    if (operators.contains(head)) {
      expr = mo(operators[head]);
    } else {
      expr = head;
    }

  } else {
    // TODO: unicode literate throwaway
    expr = head;
  }

  return [expr, tail];
}


function infix2prefix(el, mathml, op, rest) {
  // If we have an infix operator, and need to parse it as prefix,
  // this is our function to do that.

  // TODO: To complicated, refactor!

  let splitml = splitlast(mathml),
      leadml = splitml[0],
      lastml = op === "/" || op == "./" ? function() {
        let brackremoved = removeSurroundingBrackets(splitml[1]);
        if (!splitlast(brackremoved)[1].startsWith("<mrow>")) {
          // Somebody surrounded just one element in the denominator,
          // they probably want their brackets retained
          return splitml[1];
        } else {
          return brackremoved;
        }
      }() : splitml[1],
      under = (op.match(/\.[_\^]/) ||
               lastml ===  mo("∑") || lastml === mi("lim") || lastml === mo("∏"));

  let nextel, rem;
  if (!rest.match(new RegExp("^\s*" + groupings.open.regexp.source))) {
    // treat non-whitespace as one group
    let next, nextels;
    if (op === "/" || op === "./") {
      next = rest.trim().split(/(\s+|[,;])/)[0];
      if (rest[0] !== " " && next.slice(1).match(operators.regexp)) {
        // split by that operator instead
        next = next[0] + next.slice(1).split(operators.regexp)[0];
      }
    } else if (op === "^" || op === ".^") {
      next = rest.trim().split(/(\s+|[,;]|\.?_)/)[0];
      if (next.slice(1).match(operators.regexp)) {
        // split by that operator instead
        next = next[0] + next.slice(1).split(operators.regexp)[0];
      }
    } else if (op === "_" || op === "._") {
      next = rest.trim().split(/(\s+|[,;]|\.?\^)/)[0];
      if (next.slice(1).match(operators.regexp)) {
        // split by that operator instead
        next = next[0] + next.slice(1).split(operators.regexp)[0];
      }
    }
    nextels = parse(next, "");
    nextel = splitlast(nextels)[1] === nextels ? nextels : mrow(nextels),
    rem = rest.trim().slice(next.length);
  } else {
    // Treat brackets as group
    let one = parseone(rest.trim()[0], rest.trim().slice(1), true);
    nextel = one[0],
    rem = one[1];
  }

  if (rem[0] &&
      ((op === '^' && rem[0] === '_' && !rem[1].match(/^[_|]/)) ||
       (op === '.^' && rem.match(/^\.?_[^_|]/)) ||
       (op === '_' && rem[0] === '^' && rem[1] !== '^') ||
       (op === '._' && rem.match(/^\.?^[^\^]/)))) {
    // We have sup/under and super/over-scripts together
    let two = parseone(rem[op.length], rem.slice(op.length+1), true);
    let arg1 = op.match(/\.?_/) ? nextel : two[0],
        arg2 = op.match(/\.?_/) ? two[0] : nextel,
        ren = two[1];

    let tagname = under ? munderover : msubsup;
    let nextml = leadml + tagname(lastml + arg1 + arg2);

    return [ren, nextml];
  }

  if (under && op === "_") el = munder;

  let nextml = leadml + el(lastml + nextel);

  return [rem, nextml];
}

function splitlast(mathml) {
  /**
   Return a pair of all but last eliment and the last eliment
   */
  let lastel = getlastel(mathml);
  let prewels = mathml.slice(0, mathml.lastIndexOf(lastel));

  return [prewels, lastel];
}


function removeSurroundingBrackets(mathml) {
  let inside = mathml.replace(/^<mfenced[^>]*>/, "")
        .replace(/<\/mfenced>$/, "");
  if (splitlast(inside)[1] === inside) return inside;
  else return mrow(inside);
}


function getlastel(xmlstr) {
  // This breaks the linearity of the implimentation
  // optimation possible, perhaps an XML parser
  let tagname = xmlstr.match(/<\/(m[a-z]+)>$/)[1];

  let i = xmlstr.length-(tagname.length+3),
      inners = 0;
  for (i; i >= 0; i--) {
    if (xmlstr.slice(i).startsWith("<"+tagname)) {
      if (inners === 0) break;
      inners -= 1;
    }
    if (xmlstr.slice(i-2).startsWith("</"+tagname)) {
      inners += 1;
    }
  }

  return xmlstr.slice(i);
}

function parsetable(matrix) {
  let rows = rowsplit(matrix)
        .map(function(el) { return el.trim().slice(1, -1); });

  return mtable(rows.map(parserow).join(''));
}

function parserow(row, acc) {
  acc = typeof acc === 'string' ? acc : "";
  if (!row || row.length === 0) return mtr(acc);

  let split = parsecell(row.trim(), "");
  return parserow(split[1].trim(), acc+split[0]);
}

function parsecell(cell, acc) {
  if (!cell || cell.length === 0) return [mtd(acc), ""];
  if (cell[0] === ',') return [mtd(acc), cell.slice(1).trim()];

  let split = parseone(cell[0], cell.slice(1));
  return parsecell(split[1].trim(), acc+split[0]);
}

function last(arr) {
  return arr.slice(-1)[0];
}

function compose(f, g) {
  return function(x) { return f(g(x)); };
}


function idfun(x) { return x; }

module.exports = ascii2mathml;
