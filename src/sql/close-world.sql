UPDATE  public.worlds
SET open = FALSE,
    close_date = TIMEZONE('UTC', NOW())
WHERE market = $1
AND num = $2
