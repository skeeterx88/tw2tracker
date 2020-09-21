SELECT EXISTS(
    SELECT 1
    FROM main.worlds
    WHERE market = $1
    AND num = $2
)
