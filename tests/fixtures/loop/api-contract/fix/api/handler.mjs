// Fixture for the repair-loop tests. Not application code.
export function getItem(id) {
  return { id, name: `item-${id}`, quantity: id * 2 };
}
