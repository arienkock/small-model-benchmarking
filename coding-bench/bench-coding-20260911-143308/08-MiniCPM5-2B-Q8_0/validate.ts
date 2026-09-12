function validateEntry(name, message) {
  if (!name || name.length > 40) {
    return { ok: false, error: "name must not be empty or longer than 40 characters" };
  }
  if (!message || message.length > 200) {
    return { ok: false, error: "message must not be empty or longer than 200 characters" };
  }
  return { ok: true };
}

module.exports = { validateEntry };
