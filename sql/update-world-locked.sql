UPDATE  main.worlds
SET open = FALSE
WHERE market = $1
AND num = $2
