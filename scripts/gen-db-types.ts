// Generates src/types/database.ts from the real migrations (applied in PGlite).
// Usage: npm run db:types
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDb } from '../tests/db/harness'

const OUT = join(import.meta.dirname, '../src/types/database.ts')

const db = await createDb({ withAdmin: false })

const enums = (
  await db.query<{ name: string; labels: string[] }>(`
    select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
    from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typnamespace = 'public'::regnamespace group by t.typname order by t.typname`)
).rows
const enumNames = new Set(enums.map((e) => e.name))

function tsType(udt: string, isArray = false): string {
  if (udt.startsWith('_')) return `${tsType(udt.slice(1))}[]`
  if (enumNames.has(udt)) return `Database['public']['Enums']['${udt}']`
  const base = (() => {
    switch (udt) {
      case 'int2': case 'int4': case 'int8': case 'float4': case 'float8': case 'numeric': return 'number'
      case 'bool': return 'boolean'
      case 'json': case 'jsonb': return 'Json'
      case 'uuid': case 'text': case 'varchar': case 'bpchar': case 'date': case 'time': case 'timestamptz': case 'timestamp': case 'tstzrange':
        return 'string'
      default: return 'unknown'
    }
  })()
  return isArray ? `${base}[]` : base
}

type Col = { table_name: string; column_name: string; udt_name: string; is_nullable: string; column_default: string | null; is_generated: string; is_identity: string; table_type: string }
const cols = (
  await db.query<Col>(`
    select c.table_name, c.column_name, c.udt_name, c.is_nullable, c.column_default, c.is_generated, c.is_identity, t.table_type
    from information_schema.columns c join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
    where c.table_schema = 'public' order by c.table_name, c.ordinal_position`)
).rows

type Fk = { table_name: string; name: string; columns: string[]; ref_table: string; ref_columns: string[] }
const fks = (
  await db.query<Fk>(`
    select cl.relname as table_name, con.conname as name,
           array(select a.attname from unnest(con.conkey) k join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k) as columns,
           rcl.relname as ref_table,
           array(select a.attname from unnest(con.confkey) k join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k) as ref_columns
    from pg_constraint con join pg_class cl on cl.oid = con.conrelid join pg_class rcl on rcl.oid = con.confrelid
    where con.contype = 'f' and cl.relnamespace = 'public'::regnamespace and rcl.relnamespace = 'public'::regnamespace
    order by cl.relname, con.conname`)
).rows

type Fn = { name: string; arg_names: string[] | null; arg_types: string[]; arg_defaults: number; ret: string; retset: boolean; out_cols: { name: string; type: string }[] | null }
const fns = (
  await db.query<Fn>(`
    select p.proname as name, p.proargnames as arg_names,
           array(select t.typname from unnest(p.proargtypes) with ordinality as a(oid, n) join pg_type t on t.oid = a.oid order by a.n) as arg_types,
           p.pronargdefaults as arg_defaults, rt.typname as ret, p.proretset as retset,
           (select json_agg(json_build_object('name', n, 'type', t.typname) order by ord)
              from unnest(p.proallargtypes, p.proargmodes, p.proargnames) with ordinality as x(typ, mode, n, ord)
              join pg_type t on t.oid = x.typ where x.mode in ('o', 't')) as out_cols
    from pg_proc p join pg_type rt on rt.oid = p.prorettype
    where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')
    order by p.proname`)
).rows

const tables = [...new Set(cols.filter((c) => c.table_type === 'BASE TABLE').map((c) => c.table_name))]
const views = [...new Set(cols.filter((c) => c.table_type === 'VIEW').map((c) => c.table_name))]

const rel = (table: string) =>
  fks
    .filter((f) => f.table_name === table)
    .map(
      (f) =>
        `{ foreignKeyName: '${f.name}'; columns: [${f.columns.map((c) => `'${c}'`).join(', ')}]; isOneToOne: false; referencedRelation: '${f.ref_table}'; referencedColumns: [${f.ref_columns.map((c) => `'${c}'`).join(', ')}] }`,
    )
    .join(',\n          ')

function tableBlock(name: string, isView: boolean) {
  const c = cols.filter((x) => x.table_name === name)
  // Generated document references (ref) are never null on tables.
  const nullable = (x: Col) => x.is_nullable === 'YES' && !(x.column_name === 'ref' && !isView)
  const row = c.map((x) => `${x.column_name}: ${tsType(x.udt_name)}${nullable(x) ? ' | null' : ''}`).join('\n          ')
  const writable = c.filter((x) => x.is_generated !== 'ALWAYS' && x.is_identity !== 'YES' && !(x.column_default ?? '').startsWith('nextval'))
  const insert = writable
    .map((x) => {
      const optional = x.is_nullable === 'YES' || x.column_default !== null
      return `${x.column_name}${optional ? '?' : ''}: ${tsType(x.udt_name)}${x.is_nullable === 'YES' ? ' | null' : ''}`
    })
    .join('\n          ')
  const update = writable.map((x) => `${x.column_name}?: ${tsType(x.udt_name)}${x.is_nullable === 'YES' ? ' | null' : ''}`).join('\n          ')
  return `      ${name}: {
        Row: {
          ${row}
        }${isView ? '' : `
        Insert: {
          ${insert}
        }
        Update: {
          ${update}
        }`}
        Relationships: [
          ${rel(name)}
        ]
      }`
}

function fnBlock(f: Fn) {
  const names = f.arg_names ?? []
  const n = f.arg_types.length
  const args = f.arg_types
    .map((t, i) => `${names[i] ?? `arg${i}`}${i >= n - f.arg_defaults ? '?' : ''}: ${tsType(t)}${i >= n - f.arg_defaults ? ' | null' : ''}`)
    .join('; ')
  let ret: string
  if (f.ret === 'record' && f.out_cols) {
    ret = `{ ${f.out_cols.map((o) => `${o.name}: ${tsType(o.type)}`).join('; ')} }${f.retset ? '[]' : ''}`
  } else {
    ret = tsType(f.ret) === 'unknown' ? (f.ret === 'void' ? 'undefined' : 'unknown') : tsType(f.ret)
  }
  return `      ${f.name}: { Args: ${n ? `{ ${args} }` : 'Record<string, never>'}; Returns: ${ret} }`
}

const out = `// GENERATED by scripts/gen-db-types.ts from supabase/migrations — do not edit by hand.
// Regenerate with: npm run db:types

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
${tables.map((t) => tableBlock(t, false)).join('\n')}
    }
    Views: {
${views.map((t) => tableBlock(t, true)).join('\n')}
    }
    Functions: {
${fns.map(fnBlock).join('\n')}
    }
    Enums: {
${enums.map((e) => `      ${e.name}: ${e.labels.map((l) => `'${l}'`).join(' | ')}`).join('\n')}
    }
    CompositeTypes: { [_ in never]: never }
  }
}

type PublicSchema = Database['public']
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row']
export type Views<T extends keyof PublicSchema['Views']> = PublicSchema['Views'][T]['Row']
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T]
export type FunctionReturns<T extends keyof PublicSchema['Functions']> = PublicSchema['Functions'][T]['Returns']

export type TransactionType = Enums<'transaction_type'>
export type PaymentMethod = Enums<'money_method'>
`
writeFileSync(OUT, out)
console.log(`Wrote ${OUT}: ${tables.length} tables, ${views.length} views, ${fns.length} functions, ${enums.length} enums`)
await db.close()
