'use strict';

const ROLES = ['admin', 'police', 'court', 'jail'];

const PERSON_STATUSES = [
  'Suspect', 'Wanted', 'Absconding', 'Arrested', 'On Bail',
  'In Custody', 'Convicted', 'Imprisoned', 'Acquitted', 'Released',
];
const GENDERS = ['Male', 'Female', 'Other'];
const RISK_LEVELS = ['Low', 'Medium', 'High'];

const FIR_STATUSES = ['Registered', 'Under Investigation', 'Charge Sheeted', 'Closed'];

const CASE_TYPES = ['Criminal Trial', 'Bail Application', 'Remand', 'Appeal', 'Revision'];
const CASE_STATUSES = ['Pending', 'Under Trial', 'Reserved for Judgment', 'Disposed'];
const VERDICTS = ['Pending', 'Convicted', 'Acquitted', 'Discharged', 'Bail Granted'];

const JAIL_CATEGORIES = ['Remand', 'Undertrial', 'Convict'];
const RELEASE_REASONS = ['Sentence Completed', 'Bail', 'Acquitted', 'Transferred', 'Parole', 'Other'];

/** Which roles may write to each module. Every signed-in user may read everything. */
const WRITE_ACCESS = {
  persons: ['admin', 'police'],
  firs: ['admin', 'police'],
  arrests: ['admin', 'police'],
  court: ['admin', 'court'],
  jail: ['admin', 'jail'],
  users: ['admin'],
};

module.exports = {
  ROLES, PERSON_STATUSES, GENDERS, RISK_LEVELS, FIR_STATUSES, CASE_TYPES,
  CASE_STATUSES, VERDICTS, JAIL_CATEGORIES, RELEASE_REASONS, WRITE_ACCESS,
};
