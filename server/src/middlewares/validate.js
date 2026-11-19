export function validate({ params, query, body } = {}) {
  return (req, res, next) => {
    try {
      const validated = {};
      if (params) {
        validated.params = params.parse(req.params);
      }
      if (query) {
        validated.query = query.parse(req.query);
      }
      if (body) {
        validated.body = body.parse(req.body);
      }
      res.locals.validated = validated;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function getValidated(res) {
  return res.locals.validated || {};
}
