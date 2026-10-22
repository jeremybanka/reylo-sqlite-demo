import type { SQL } from "bun";
import createTask, { type Params } from "../src/queries/create_task.sql";
import getTask from "../src/queries/get_task.sql";

// Compile-only fixtures. @ts-expect-error must be used, so a lost mapper or
// weakened parameter/output type fails this file's typecheck.
export async function verifyInferredTypes(db: SQL) {
  const valid: Params = { id: "fixture", title: "typed", body: "", status: "planned" };
  const row = await createTask.run(db, valid);
  const title: string = row.title;
  // @ts-expect-error SQL TEXT parameters reject numbers.
  const wrong: Params = { ...valid, title: 123 };
  // @ts-expect-error SQL imports require every named parameter.
  await createTask.run(db, { id: "missing" });
  // @ts-expect-error This column does not exist in the SQL projection.
  const absent = row.imaginary_column;
  const maybe = await getTask.run(db, { id: "fixture" });
  // @ts-expect-error Primary-key lookup can return null.
  const unsafe: string = maybe.title;
  return { title, wrong, absent, unsafe };
}
