BEGIN;
ALTER TABLE wallet.postings ALTER COLUMN signed_amount TYPE NUMERIC USING signed_amount::NUMERIC;
ALTER TABLE wallet.postings ADD CONSTRAINT supported_posting_currency CHECK(currency IN ('AUD','CNY','USD','EUR','GBP','NZD','CAD','HKD','SGD','JPY','KRW','KWD','BHD'));
ALTER TABLE wallet.postings ADD CONSTRAINT posting_currency_precision CHECK(scale(signed_amount)<=CASE WHEN currency IN ('JPY','KRW') THEN 0 WHEN currency IN ('KWD','BHD') THEN 3 ELSE 2 END);
ALTER TABLE wallet.postings ADD CONSTRAINT posting_amount_range CHECK(abs(signed_amount)<=999999999999.999);
COMMIT;
