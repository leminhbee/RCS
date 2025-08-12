const ava = require('../AVA');
const logger = require('../helpers/logger');
const moment = require('moment');

const handleRequest = async (req, res) => {
  const body = req.body;
  const user = body.alulaUser;
  try {
    // Define a map for status updates based on event_aux_type
    const statusMap = {
      'AVAILABLE': {
        statusText: `Available @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':large_green_circle:',
      },
      'LUNCH': {
        statusText: `Lunch @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':hamburger:',
      },
      'ON-BREAK': {
        statusText: `Break @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':clock:',
      },
      'TRAINING': {
        statusText: `Training @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':question-block:',
      },
      'OUTBOUND': {
        statusText: `OUTBOUND @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':phone:',
      },
      'Meeting': {
        statusText: `Meeeting @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':spiral_calendar_pad:',
      },
      'Follow-Up': {
        statusText: `Follow Up @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':pencil:',
      },
      'Email Support': {
        statusText: `Email Support @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':email:',
      },
      'Bathroom Break': {
        statusText: `Bathroom @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':toilet:',
      },
      'ENGAGED' : {
        statusText: `On Call @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':telephone_receiver:',
      },
      'RNA-STATE' : {
        statusText: `RNA @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':no_mobile_phones:',
      },
    };

    if (body.event_aux_type === 'ENGAGED' && body.prev_aux_state === 'OUTBOUND') {
      return;
    };

    if (statusMap[body.event_aux_type]){
      ava.status.update({
        slackId: user.slackId,
        ...statusMap[body.event_aux_type],
      });
      logger.info({ body, event: 'status update' });
    } else {
      throw new Error('Unkown status set');
    }
  } catch (error) {
    logger.error({ body, event: 'status update', error }, 'Error handling status webhook');
  }
};

module.exports = handleRequest;
