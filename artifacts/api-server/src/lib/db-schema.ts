export const REQUIRED_TABLES = [
  'settings', 'items', 'transactions', 'orders', 'customers', 'expenses', 'users'
];

export const CORE_TABLES = ['settings', 'items', 'transactions', 'orders'];

export function supabaseErrorMessage(error: any): string {
  if (!error) return '';
  return String(error.message || error.hint || error.code || '').trim();
}

export function isMissingTableError(error: any): boolean {
  const message = supabaseErrorMessage(error);
  return (
    error?.code === 'PGRST205' ||
    error?.code === '42P01' ||
    /does not exist/i.test(message) ||
    /could not find the table/i.test(message)
  );
}

export function isMissingUserIdColumnError(error: any): boolean {
  const message = supabaseErrorMessage(error);
  return error?.code === '42703' || /column\s+[\w.]+\.user_id\s+does not exist/i.test(message);
}

export function isMissingColumnError(error: any, columnName: string): boolean {
  const message = supabaseErrorMessage(error);
  const col = String(columnName || '').trim();
  if (!col) return false;
  const colPattern = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    error?.code === '42703' ||
    error?.code === 'PGRST204' ||
    new RegExp(`column\\s+[\\w.]*${colPattern}\\s+does not exist`, 'i').test(message) ||
    new RegExp(`could not find the ['"]?${colPattern}['"]? column`, 'i').test(message)
  );
}

export function missingCustomersAddressMessage(): string {
  return 'Customers table is missing the address column. Run supabase/customers-address.sql in the Supabase SQL Editor.';
}

export function missingUserIdMessage(): string {
  return 'Database schema is outdated (column user_id missing). Run supabase/per-user-data.sql in the Supabase SQL Editor and replace YOUR_USER_UUID with your auth user id.';
}

export function missingTablesMessage(missingTables: string[]): string {
  const list = missingTables.join(', ');
  return `Database tables missing (${list}). Run supabase/schema.sql in the Supabase SQL Editor.`;
}
