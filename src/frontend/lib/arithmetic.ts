/**
 * Small recursive-descent evaluator for +, -, *, /, and parentheses.
 * Hand-rolled (no eval/Function) to avoid the RCE class of bug affecting
 * npm expression-eval packages (e.g. CVE-2025-12735).
 */
import { roundMoney } from "@/frontend/lib/data";
/** True when the string is just a plain (possibly partial) decimal number, not an expression. */
export function isPlainNumber(input: string): boolean {
  return /^\d*\.?\d*$/.test(input.trim());
}

export function evaluateExpression(input: string): number | null {
  const tokens = tokenize(input);
  if (!tokens) return null;

  const parser = new Parser(tokens);
  const value = parser.parseExpression();
  if (value === null || !parser.atEnd()) return null;
  if (!Number.isFinite(value)) return null;
  return roundMoney(value);
}

type Token = { type: "num"; value: number } | { type: "op"; value: string };

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if ("+-*/()".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i + 1;
      while (j < input.length && /[0-9.]/.test(input.charAt(j))) j++;
      const raw = input.slice(i, j);
      if ((raw.match(/\./g) || []).length > 1) return null;
      const value = Number(raw);
      if (Number.isNaN(value)) return null;
      tokens.push({ type: "num", value });
      i = j;
      continue;
    }
    return null;
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isOp(value: string): boolean {
    const t = this.peek();
    return t?.type === "op" && t.value === value;
  }

  parseExpression(): number | null {
    let left = this.parseTerm();
    if (left === null) return null;
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.peek() as Token & { type: "op" }).value;
      this.pos++;
      const right = this.parseTerm();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  private parseTerm(): number | null {
    let left = this.parseFactor();
    if (left === null) return null;
    while (this.isOp("*") || this.isOp("/")) {
      const op = (this.peek() as Token & { type: "op" }).value;
      this.pos++;
      const right = this.parseFactor();
      if (right === null) return null;
      if (op === "/") {
        if (right === 0) return null;
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  private parseFactor(): number | null {
    if (this.isOp("-")) {
      this.pos++;
      const value = this.parseFactor();
      return value === null ? null : -value;
    }
    if (this.isOp("+")) {
      this.pos++;
      return this.parseFactor();
    }
    if (this.isOp("(")) {
      this.pos++;
      const value = this.parseExpression();
      if (value === null || !this.isOp(")")) return null;
      this.pos++;
      return value;
    }
    const t = this.peek();
    if (t?.type === "num") {
      this.pos++;
      return t.value;
    }
    return null;
  }
}
