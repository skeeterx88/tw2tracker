UPDATE  public.worlds
SET open = FALSE,
    close_date = TIMEZONE('UTC', NOW())
WHERE market_id = $1
AND world_number = $2
