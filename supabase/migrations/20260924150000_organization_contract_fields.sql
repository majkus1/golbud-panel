-- Dane firmy do umów i dokumentów na wzorach GolBud (spółka komandytowa).
-- Wzory Dawida mają w komparycji KRS, REGON, sposób reprezentacji i pełnomocnika,
-- a w nagłówku dwa telefony. Kolumny są opcjonalne — puste pola program uzupełnia
-- domyślnymi danymi z lib/golbud-offer-config.ts. Istniejących danych nie zmieniamy.

alter table public.organizations
  add column if not exists offer_krs text,
  add column if not exists offer_regon text,
  add column if not exists offer_representation text,
  add column if not exists offer_proxy text,
  add column if not exists offer_phone_secondary text,
  add column if not exists offer_seat text,
  add column if not exists offer_slogan text;

comment on column public.organizations.offer_krs is 'Numer KRS do komparycji umów i nagłówka dokumentów.';
comment on column public.organizations.offer_regon is 'REGON do komparycji umów.';
comment on column public.organizations.offer_representation is 'Sposób reprezentacji, np. „komplementariusza Dawida Golczuka, uprawnionego do jednoosobowej reprezentacji spółki”.';
comment on column public.organizations.offer_proxy is 'Pełnomocnik do umów przedwstępnych, w bierniku, np. „Kacpra Szmurło”.';
comment on column public.organizations.offer_phone_secondary is 'Drugi telefon w nagłówku dokumentów.';
comment on column public.organizations.offer_seat is 'Siedziba w miejscowniku, np. „Ożarowie Mazowieckim” — „z siedzibą w …”, „zawarta w …”.';
comment on column public.organizations.offer_slogan is 'Hasło w stopce dokumentów (opcjonalne).';

notify pgrst, 'reload schema';
