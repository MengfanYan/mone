// Classification changes explanations only; it never grants execution authority.
export function isEducationalQuestion(text) {
  return (
    /^(?:please\s+)?(?:explain|why|what|how|compare|describe)\b|^(?:请)?(?:解释|说明|比较|为什么|什么是)/i.test(
      text.trim(),
    ) &&
    !/(?:^|[.!;。；]\s*|\b(?:then|and)\s+)(?:please\s+)?(?:buy|sell|pay|transfer|delete|execute|send)\b|然后(?:买入|卖出|支付|转账|删除|执行)/i.test(
      text,
    )
  );
}
