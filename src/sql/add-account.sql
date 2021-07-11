INSERT INTO public.accounts (name, pass, markets)
VALUES (${name}, ${pass}, '{}')
RETURNING id;
