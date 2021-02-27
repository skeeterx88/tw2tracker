SELECT * FROM public.mods
WHERE LOWER(email) = LOWER(${email})
