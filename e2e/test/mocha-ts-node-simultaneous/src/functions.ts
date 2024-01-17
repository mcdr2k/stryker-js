// 0: BlockStatement '{}' -> error
export function add(a: number, b: number): number {
  // 1: ArithmeticOperator 'a - b'
  return a + b;
}

// 2: BlockStatement '{}' -> error
export function subtract(a: number, b: number): number {
  // 3: ArithmeticOperator 'a + b'
  return a - b;
}

// 4: BlockStatement '{}' -> error
export function confuse(a: number, b: number, confused: boolean): number {
  // 5: ConditionalExpression 'true'
  // 6: ConditionalExpression 'false'
  if (confused) {
    // 7: BlockStatement '{}'
    return add(a, b);
  }
  return subtract(a, b);
}
