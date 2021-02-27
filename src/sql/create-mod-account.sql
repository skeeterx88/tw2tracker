INSERT INTO public.mods (
    name,
    pass,
    email,
    privileges
) VALUES (
    ${name},
    ${pass},
    ${email},
    ${privileges}::mod_privilege_types[]
)
RETURNING id;
