// Prints its first argument and exits with its second, so evidence-recorder tests need no inline interpreter command.
console.log(process.argv[2] ?? '');
process.exit(Number(process.argv[3] ?? 0));
