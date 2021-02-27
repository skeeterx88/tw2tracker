INSERT INTO public.mods (
    name,
    pass,
    email,
    privileges
) VALUES (
    ${name},
    ${pass},
    LOWER(${email}),
    ${privileges}::mod_privilege_types[]
)
RETURNING id;
