-- Dane firmy na PDF oferty (Ustawienia → Firma)

alter table public.organizations
  add column if not exists offer_legal_name text,
  add column if not exists offer_nip text,
  add column if not exists offer_address_line text,
  add column if not exists offer_postal_city text,
  add column if not exists offer_phone text,
  add column if not exists offer_email text,
  add column if not exists offer_website text,
  add column if not exists offer_bank_account text,
  add column if not exists offer_bank_name text,
  add column if not exists offer_payment_terms text,
  add column if not exists offer_default_vat_rate numeric default 8
    check (offer_default_vat_rate is null or (offer_default_vat_rate >= 0 and offer_default_vat_rate <= 100)),
  add column if not exists offer_validity_days integer default 30
    check (offer_validity_days is null or (offer_validity_days > 0 and offer_validity_days <= 365));

-- Wstępne uzupełnienie dla istniejących organizacji (można potem zmienić w panelu)
update public.organizations
set
  offer_legal_name = coalesce(nullif(trim(offer_legal_name), ''), 'Golbud Dawid Golczuk — usługi ogólnobudowlane'),
  offer_nip = coalesce(nullif(trim(offer_nip), ''), '1182217667'),
  offer_address_line = coalesce(nullif(trim(offer_address_line), ''), 'ul. Wincentego Witosa 8a'),
  offer_postal_city = coalesce(nullif(trim(offer_postal_city), ''), '05-850 Ożarów Mazowiecki'),
  offer_phone = coalesce(nullif(trim(offer_phone), ''), '+48 508 792 580'),
  offer_email = coalesce(nullif(trim(offer_email), ''), 'kontakt.golbud@gmail.com'),
  offer_website = coalesce(nullif(trim(offer_website), ''), 'www.gol-bud.com'),
  offer_payment_terms = coalesce(
    nullif(trim(offer_payment_terms), ''),
    'Przelew na konto w terminie 7 dni od daty faktury, o ile strony nie ustalą inaczej. Przy większych zleceniach możliwa zaliczka — do uzgodnienia.'
  ),
  offer_default_vat_rate = coalesce(offer_default_vat_rate, 8),
  offer_validity_days = coalesce(offer_validity_days, 30)
where offer_legal_name is null
   or offer_nip is null
   or offer_address_line is null;

-- Właściciel może aktualizować organizację (nazwa + dane na PDF)
drop policy if exists org_update_owner on public.organizations;
create policy org_update_owner on public.organizations
for update
using (
  id in (
    select organization_id
    from public.organization_members
    where user_id = auth.uid() and role = 'owner'
  )
)
with check (
  id in (
    select organization_id
    from public.organization_members
    where user_id = auth.uid() and role = 'owner'
  )
);
