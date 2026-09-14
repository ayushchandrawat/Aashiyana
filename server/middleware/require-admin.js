
export function requireAdmin(req, res, next) {
  if (req.authRole === 'admin') {
    return next();
  }
  res.status(403).json({ error: 'Permission denied.', code: 403 });
}
