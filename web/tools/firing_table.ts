// ============================================================================
//  firing_table.ts — CLI del generador de tablas de tiro (P4.3).
//
//  Uso:
//      npx tsx tools/firing_table.ts [arma] [carga] [paso_m]
//      npm run firing-table -- m777 3 1000 > m777_c8.csv
//
//  arma:   mortar120 | m777 | gmlrs | tacticalMissile   (defecto m777)
//  carga:  índice en las zonas de carga, -1 = por defecto (defecto -1)
//  paso_m: separación entre filas en metros (defecto 1000)
//
//  Emite CSV por stdout: alcance, QE baja/alta, TOF, V de impacto y deriva.
// ============================================================================
import { WeaponCatalog, WeaponId } from '../src/ballistics/WeaponCatalog';
import { firingTableCSV, generateFiringTable } from '../src/ballistics/FiringTables';

const id = (process.argv[2] ?? 'm777') as WeaponId;
const charge = Number(process.argv[3] ?? '-1');
const step = Number(process.argv[4] ?? '1000');

if (!WeaponCatalog.ids().includes(id)) {
  console.error(`Arma desconocida "${id}". Opciones: ${WeaponCatalog.ids().join(', ')}`);
  process.exit(1);
}

const weapon = WeaponCatalog.get(id);
console.error(`Generando tabla de tiro: ${weapon.name}, carga ${charge}, paso ${step} m...`);
const table = generateFiringTable(weapon, charge, { stepM: step });
process.stdout.write(firingTableCSV(table));
console.error(`Listo: ${table.rows.length} filas, alcance máx ${table.maxRangeM.toFixed(0)} m.`);
