"""Safe arithmetic for ``row_formula`` rules (no ``eval``).

Grammar::

    formula := expr "=" expr
    expr    := term (("+" | "-") term)*
    term    := factor (("*" | "/") factor)*
    factor  := ("+" | "-") factor | NUMBER | NAME | "[" any text "]" | "(" expr ")"

``NAME`` is a column key written bare (any run of characters that are not whitespace,
operators, parentheses, brackets or ``=``, not starting with a digit or ``.``) or in
brackets (``[주입 수량]``) when it contains such characters.
"""

import re
from dataclasses import dataclass

_OPERATORS = set("+-*/()=")
_NUMBER_RE = re.compile(r"\d+(?:\.\d+)?|\.\d+")


class FormulaError(ValueError):
    pass


@dataclass(frozen=True)
class Num:
    value: float


@dataclass(frozen=True)
class Name:
    key: str


@dataclass(frozen=True)
class Unary:
    op: str
    operand: "Node"


@dataclass(frozen=True)
class Binary:
    op: str
    left: "Node"
    right: "Node"


Node = Num | Name | Unary | Binary


@dataclass(frozen=True)
class Formula:
    left: Node
    right: Node

    def names(self) -> set[str]:
        return _names(self.left) | _names(self.right)


def _names(node: Node) -> set[str]:
    if isinstance(node, Name):
        return {node.key}
    if isinstance(node, Unary):
        return _names(node.operand)
    if isinstance(node, Binary):
        return _names(node.left) | _names(node.right)
    return set()


def _tokenize(text: str) -> list[tuple[str, str]]:
    tokens: list[tuple[str, str]] = []
    index = 0
    while index < len(text):
        char = text[index]
        if char.isspace():
            index += 1
            continue
        if char in _OPERATORS:
            tokens.append(("op", char))
            index += 1
            continue
        if char == "[":
            end = text.find("]", index + 1)
            if end < 0:
                raise FormulaError("unclosed '['")
            key = text[index + 1 : end].strip()
            if not key:
                raise FormulaError("empty column name '[]'")
            tokens.append(("name", key))
            index = end + 1
            continue
        if char == "]":
            raise FormulaError("unexpected ']'")
        number = _NUMBER_RE.match(text, index)
        if number and (char.isdigit() or char == "."):
            tokens.append(("num", number.group(0)))
            index = number.end()
            continue
        start = index
        while index < len(text) and not text[index].isspace() and text[index] not in _OPERATORS and text[index] not in "[]":
            index += 1
        tokens.append(("name", text[start:index]))
    return tokens


class _Parser:
    def __init__(self, tokens: list[tuple[str, str]]) -> None:
        self.tokens = tokens
        self.position = 0

    def peek(self) -> tuple[str, str] | None:
        return self.tokens[self.position] if self.position < len(self.tokens) else None

    def take(self) -> tuple[str, str]:
        token = self.peek()
        if token is None:
            raise FormulaError("unexpected end of expression")
        self.position += 1
        return token

    def expr(self) -> Node:
        node = self.term()
        while (token := self.peek()) and token[0] == "op" and token[1] in "+-":
            self.take()
            node = Binary(token[1], node, self.term())
        return node

    def term(self) -> Node:
        node = self.factor()
        while (token := self.peek()) and token[0] == "op" and token[1] in "*/":
            self.take()
            node = Binary(token[1], node, self.factor())
        return node

    def factor(self) -> Node:
        kind, value = self.take()
        if kind == "num":
            return Num(float(value))
        if kind == "name":
            return Name(value)
        if value in "+-":
            return Unary(value, self.factor())
        if value == "(":
            node = self.expr()
            closing = self.take()
            if closing != ("op", ")"):
                raise FormulaError("missing ')'")
            return node
        raise FormulaError(f"unexpected '{value}'")


def parse_expression(text: str) -> Node:
    parser = _Parser(_tokenize(text))
    node = parser.expr()
    if parser.peek() is not None:
        raise FormulaError(f"unexpected '{parser.peek()[1]}'")
    return node


def parse_formula(text: str) -> Formula:
    if text.count("=") != 1:
        raise FormulaError("a formula needs exactly one '='")
    left_text, right_text = text.split("=")
    if not left_text.strip() or not right_text.strip():
        raise FormulaError("both sides of '=' are required")
    return Formula(parse_expression(left_text), parse_expression(right_text))


def evaluate(node: Node, values: dict[str, float | None]) -> float | None:
    """Value of ``node``; ``None`` when an operand is missing or a division by zero occurs."""
    if isinstance(node, Num):
        return node.value
    if isinstance(node, Name):
        return values.get(node.key)
    if isinstance(node, Unary):
        operand = evaluate(node.operand, values)
        if operand is None:
            return None
        return -operand if node.op == "-" else operand
    left = evaluate(node.left, values)
    right = evaluate(node.right, values)
    if left is None or right is None:
        return None
    if node.op == "+":
        return left + right
    if node.op == "-":
        return left - right
    if node.op == "*":
        return left * right
    if right == 0:
        return None
    return left / right
