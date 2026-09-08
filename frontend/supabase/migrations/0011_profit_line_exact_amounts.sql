-- Preserve quantity (six decimals) × ERP unit cost (four decimals) without
-- rounding immutable profit facts on cloud persistence. Existing values and
-- all authorization/immutability rules remain unchanged.
alter table public.profit_lines
  alter column purchase_cost type numeric,
  alter column profit type numeric;
