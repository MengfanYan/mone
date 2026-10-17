"use client";
import { useLocale } from "./locale-provider";
import { Money } from "./financial-values";
export default function DuplicateReview({
  reviews = [],
  resolutions = [],
  onChange,
  accounts = {},
}) {
  const { t } = useLocale();
  if (!reviews.length) return null;
  return (
    <section className="duplicate-review" aria-label={t("重复交易核对")}>
      <h3>{t("疑似重复：请核对后再入账")}</h3>
      <p>
        {t(
          "日期、金额、币种、商户、账户和类型相同。重复提交保护不能判断是否是两次真实消费。",
        )}
      </p>
      {reviews.map((review) => {
        const resolution = resolutions.find(
          (r) => r.candidate_id === review.candidate_id,
        );
        return (
          <article key={review.candidate_id}>
            <strong>
              {t("待入账候选")} · {review.candidate.merchant}
            </strong>
            <p>
              {review.candidate.date} ·{" "}
              <Money
                value={review.candidate.amount}
                currency={review.candidate.currency}
              />{" "}
              ·{" "}
              {accounts[review.candidate.account_id]?.name ||
                review.candidate.account_id}
              {" · "}
              {t(review.candidate.kind)}
            </p>
            <ul>
              {review.matches.map((match) => (
                <li key={match.id}>
                  {t("匹配记录")} · {match.merchant} · {match.date} ·{" "}
                  <Money value={match.amount} currency={match.currency} /> ·{" "}
                  {accounts[match.account_id]?.name || match.account_id} ·{" "}
                  {t(match.kind)} · {t("来源")} {match.source} · {match.id}
                </li>
              ))}
            </ul>
            <label className="inline-choice">
              <input
                type="checkbox"
                checked={Boolean(resolution)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [
                          ...resolutions,
                          { candidate_id: review.candidate_id, reason: "" },
                        ]
                      : resolutions.filter(
                          (r) => r.candidate_id !== review.candidate_id,
                        ),
                  )
                }
              />
              {t("保留为独立交易")} · {review.candidate.merchant}
            </label>
            <label>
              {t("独立交易原因（5至500字）")}
              <textarea
                aria-label={`${t("独立交易原因")} ${review.candidate_id}`}
                value={resolution?.reason || ""}
                disabled={!resolution}
                minLength={5}
                maxLength={500}
                rows={2}
                onChange={(e) =>
                  onChange(
                    resolutions.map((r) =>
                      r.candidate_id === review.candidate_id
                        ? { ...r, reason: e.target.value }
                        : r,
                    ),
                  )
                }
              />
            </label>
          </article>
        );
      })}
      <p>
        {t("不确定时请取消确认，返回草稿核对或拒绝；系统不会自动合并或删除。")}
      </p>
    </section>
  );
}
