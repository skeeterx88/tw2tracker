INSERT INTO public.accounts (
    name,
    pass
) VALUES (
    ${name},
    ${pass}
)
RETURNING id;
