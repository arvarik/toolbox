try {
  process.loadEnvFile();
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  if (code !== "ENOENT") {
    console.warn(
      `[Config] .env could not be read (${code ?? String(err)}). Its variables are not set.`,
    );
  }
}
