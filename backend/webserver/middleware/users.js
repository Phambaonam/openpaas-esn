const { logger, user } = require('../../core');
const composableMw = require('composable-middleware');
const platformadminsMW = require('../middleware/platformadmins');

module.exports = {
  checkEmailsAvailability,
  checkProfilesQueryPermission,
  loadTargetUser,
  requireProfilesQueryParams,
  requirePreferredEmail,
  validateUserStates,
  validateUsersProvision
};

function onFind(req, res, next, err, user) {
  if (err) {
    return res.status(500).json({error: {code: 500, message: 'Server error', details: err.message}});
  }

  if (!user) {
    return res.status(404).json({error: {code: 404, message: 'Not found', details: 'User not found'}});
  }

  req.targetUser = user;
  next();
}

function loadTargetUser(req, res, next) {
  if (req.params.uuid) {
    return user.get(req.params.uuid, onFind.bind(null, req, res, next));
  } else if (req.body.email) {
    return user.findByEmail(req.body.email, onFind.bind(null, req, res, next));
  } else {
    return res.status(400).json({error: {code: 400, message: 'Bad Request', details: 'uuid or email missing'}});
  }
}

function checkProfilesQueryPermission(req, res, next) {
  const middlewares = [];

  if (!req.query.email && req.query.search) {
    middlewares.push(platformadminsMW.requirePlatformAdmin);
  }

  return composableMw(...middlewares)(req, res, next);
}

function requireProfilesQueryParams(req, res, next) {
  let details;

  if (!req.query.email && !req.query.search) {
    return res.status(400).json({
      error: {
        code: 400,
        message: 'Bad Request',
        details
      }
    });
  }

  next();
}

function validateUserStates(req, res, next) {
  const states = req.body;
  const validStates = !states.some(state => !(user.states.validateUserAction(state.name) && user.states.validateActionState(state.value)));

  if (!validStates) {
    return res.status(400).json({
      error: {
        code: 400,
        message: 'Bad Request',
        details: 'States is not valid'
      }
    });
  }

  next();
}

function checkEmailsAvailability(req, res, next) {
  const emails = req.body;
  const emailsToAdd = emails.filter(email => req.targetUser.emails.indexOf(email) === -1);

  if (!emailsToAdd.length) {
    return next();
  }

  user.checkEmailsAvailability(emailsToAdd)
    .then(unavailableEmails => {
      if (unavailableEmails.length > 0) {
        return res.status(400).json({
          error: {
            code: 400,
            message: 'Bad Request',
            details: `Emails already in use: ${unavailableEmails.join(', ')}`
          }
        });
      }

      next();
    })
    .catch(err => {
      const details = 'Error while checking availability of the emails';

      logger.error(details, err);

      return res.status(500).json({
        error: {
          code: 500,
          message: 'Server Error',
          details
        }
      });
    });
}

function requirePreferredEmail(req, res, next) {
  if (req.body.indexOf(req.targetUser.preferredEmail) === -1) {
    return res.status(400).json({
      error: {
        code: 400,
        message: 'Bad Request',
        details: 'User preferred email must not be removed'
      }
    });
  }

  next();
}

function validateUsersProvision(req, res, next) {
  const { source } = req.query;
  const provider = user.provision.service.providers.get(source);

  if (!provider) {
    return res.status(400).json({
      error: {
        code: 400,
        message: 'Bad Request',
        details: `${source} is not a valid provision source`
      }
    });
  }

  provider.verify({ data: req.body, domainId: req.domain._id })
    .then(() => next())
    .catch(error => {
      if (!error.valid && error.details) {
        return res.status(400).json({
          error: {
            code: 400,
            message: 'Bad Request',
            details: error.details
          }
        });
      }

      const details = 'Unable to verify data for provisioning';

      logger.error(details, error);
      res.status(500).json({
        error: {
          code: 500,
          message: 'Server Error',
          details
        }
      });
    });
}
