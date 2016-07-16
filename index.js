// IRC module
var irc = require('irc');
// Inspect module (object dump)
var util = require('util');
// SQLite database module
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('nodejsirc.db');
var async = require('async');

// Internal storage
var store = {
    botConfig: {
        server: 'irc.rizon.net',
        port: 6697,
        nick: 'WhaleBot',
        userName: 'WhaleBot',
        realName: 'WhaleBot',
        floodDelay: 1000,
        ssl: true,
        channels: ['#whalebot'],
        nickservPassword: '123456'
    },

    ordersets: [],
    users: [],
    channels: [],
    admins: [],
    orderset_users: [],
    orderset_channels: [],
    orders: [],

    users_status: []
};

// Global flag
var waitingForNickServ = false;
var nickServCallback;
var nickServArgs;

// Populate internal storage
console.log('Loading data from DB...');

async.parallel([
    function (cb) {
        db.all('SELECT * FROM config', function (err, rows) {
            rows.forEach(function (row) {
                store.botConfig[row.key] = row.value;
            });

            cb(err);
        });
    },
    function (cb) {
        db.all('SELECT * FROM ordersets', function (err, rows) {
            store.ordersets = rows;
            cb(err);
        });
    },
    function (cb) {
        db.all('SELECT * FROM users', function (err, rows) {
            store.users = rows;
            cb(err);
        });
    },
    function (cb) {
        db.all('SELECT * FROM channels', function (err, rows) {
            store.channels = rows;
            cb(err);
        });
    },
    function (cb) {
        db.all('SELECT * FROM admins', function (err, rows) {
            store.admins = rows;
            cb(err);
        });
    },
    function (cb) {
        db.all('SELECT * FROM orderset_users', function (err, rows) {
            store.orderset_users = rows;
            cb(err);
        });
    },
    function (cb) {
        db.all('SELECT * FROM orderset_channels', function (err, rows) {
            store.orderset_channels = rows;
            cb(err);
        });
    },
    function (cb) {
        db.all('SELECT * FROM orders', function (err, rows) {
            store.orders = rows;
            cb(err);
        });
    }
], function () {
    console.log('Loaded!');
    console.log('Connecting to IRC server...');

    // Set up autojoins
    store.botConfig.channels = store.channels.filter(function (ch) {
        return ch.autojoin == 1;
    }).map(function (ch) {
        return ch.channel;
    });

    // Set bot options
    for (var key in store.botConfig) {
        bot.opt[key] = store.botConfig[key];
    }

    bot.nick = store.botConfig.nick;

    // Connect
    bot.connect();
});


// Create bot instance with semi default options
var bot = new irc.Client(store.botConfig.server, store.botConfig.nick, {
    autoConnect: false,
    port: store.botConfig.port,
    channels: store.botConfig.channels,
    floodProtection: true,
    floodProtectionDelay: store.botConfig.floodDelay,
    userName: store.botConfig.userName,
    realName: store.botConfig.realName,
    secure: store.botConfig.ssl
});

// Event handler for connecting to server
bot.addListener('registered', function (message) {
    console.log('Connected!');

    // Identify
    identifyBot();
});

// Event handler for joining
bot.addListener('join', function (channel, nick, message) {
    // console.log(nick + ' joined ' + channel);

    // Evaluate nick's status
    bot.say('NickServ', 'status ' + nick);
});

// Event handler for parting
bot.addListener('part', function (channel, nick, reason, message) {
    // console.log(nick + ' parted ' + channel);
});

// Event handler for changing nick
bot.addListener('nick', function (oldnick, newnick, channels) {
    // console.log(oldnick + ' is now ' + newnick);

    // (Re-)Evaluate new nick's status
    bot.say('NickServ', 'status ' + newnick);
});

bot.addListener('quit', function (nick, reason, channels, message) {
    // console.log(nick + ' quit from irc');
});

bot.addListener('kick', function (channel, nick, by, reason, message) {
    // console.log(nick + ' got kicked from ' + channel + ' by ' + by);
});

bot.addListener('kill', function (nick, reason, channels, message) {
    // console.log(nick + '\'s connection got killed');
});

// Message listener
bot.addListener('message', function (from, to, text, message) {
    /**
     * Message object format with util.inspect(message, false, null)
     *
     * {
     *     prefix: nick!user@host
     *     nick: nick
     *     user: user
     *     host: host
     *     command: PRIVMSG
     *     rawCommand: PRIVMSG
     *     commandType: normal
     *     args: [channel, message]
     * }
     */

    // Handle primary (admin and order) commands
    if (text[0] == '@') {
        var adminCommands = ['config', 'join', 'part', 'say', 'do', 'notice', 'whois', 'chanlist', 'addautojoin', 'deleteautojoin', 'adduser', 'deleteuser', 'listusers', 'addchan', 'deletechan', 'listchans', 'addadmin', 'deleteadmin', 'listadmins', 'addorderset', 'deleteorderset', 'listordersets'];

        var isAdminCB;

        // Admin command called
        if (adminCommands.indexOf(text.split(' ')[0].substr(1).toLowerCase()) > -1) {
            // isAdmin(from, handlePrimaryCommand, [from, to, text, message]);
            isAdminCB = handlePrimaryCommand;
        } else {
            // handleOrderCommand(from, to, text, message);
            isAdminCB = handleOrderCommand;
        }

        isAdmin(from, isAdminCB, [from, to, text, message]);

    }

    // Handle secondary (user) commands
    if (text[0] == '!') {
        handleSecondaryCommand(from, to, text, message);
    }

     // Private messages
    if (to == store.botConfig.nick) {
        privateMessage(from, text, message);
        return;
    }
});

bot.addListener('notice', function (from, to, text, message) {
    // Handle NickServ messages
    if (from !== undefined && from.toLowerCase() == 'nickserv') {
        handleNickServ(from, to, text, message);
    }
});

/*
bot.addListener('raw', function (message) {
    console.log(util.inspect(message, false, null));
});
*/

bot.addListener('error', function (message) {
    console.log('ERROR: ' + util.inspect(message, false, null));
});

function privateMessage(from, text, message) {
    console.log(from + ' -> ' + store.botConfig.nick + ': ' + text);
}

function isAdmin(nick, cb, cbarg) {
    if (store.admins.find(function (admin) { return admin.nick == nick; }) !== undefined) {
        // Is identified?
        var user = store.users_status.find(function (u) {
            return u.nick == nick;
        });

        if (user === undefined || user.status < 3) {
            waitingForNickServ = true;
            nickServCallback = cb;
            nickServArgs = cbarg;

            bot.say('NickServ', 'status ' + nick);
            return false;
        }

        // Callback
        cb(cbarg);
    }

    return false;
}

// Handle primary commands (starting with @)
// function handlePrimaryCommand(from, to, text, message) {
function handlePrimaryCommand(args) {
    // Extract encapsulated args
    var from = args[0];
    var to = args[1];
    var text = args[2];
    var message = args[3];

    var words = text.split(' ');
    var command = words[0].substr(1).toLowerCase();

    // Temp variables
    var osid, os, chid, ch, uid, u, oid, o, chName, chan;

    switch (command) {
        case 'config':
            // Change configuration
            if (words.length != 3 || words[1].length === 0 || words[2].length === 0) {
                bot.notice(from, 'Syntax: @config <key> <value>');
                return false;
            }

            if (!store.botConfig.hasOwnProperty(words[1])) {
                bot.notice(from, 'Available keys: nick, userName, realName, nickservPassword');
                return false;
            }

            store.botConfig[words[1]] = words[2];
            db.run('UPDATE config SET value = ? WHERE key = ?', words[2], words[1]);
            bot.notice(from, words[1] + ' updated');

            var theKey = words[1].toLowerCase();

            // Reidentify
            if (theKey == 'nickservPassword') {
                identify();
            }

            // Update nick
            if (theKey == 'nick') {
                updateNick();
            }
            break;
        case 'join':
            // Join a channel
            if (words.length != 2 || words[1].length === 0) {
                bot.notice(from, 'Syntax: @join <channel>');
                return false;
            }

            chName = words[1].toLowerCase();

            if (chName.indexOf(',') != -1) {
                bot.notice(from, 'Illegal character: ,');
                return false;
            }

            // Add to db if necessary
            chan = store.channels.find(function (ch) {
                return ch.channel == chName;
            });

            if (chan === undefined) {
                db.run('INSERT INTO channels (`channel`) VALUES (?)', chName, function (err) {
                    var chid = this.lastID;

                    store.channels.push({id: chid, channel: chName});
                });
            }

            bot.join(words[1], words[2]);
            break;
        case 'part':
            // Quit a channel
            if (words.length != 2 || words[1].length === 0) {
                bot.notice(from, 'Syntax: @part <channel>');
                return false;
            }

            chName = words[1].toLowerCase();

            if (chName.indexOf(',') != -1) {
                bot.notice(from, 'Illegal character: ,');
                return false;
            }

            bot.part(words[1]);
            break;
        case 'say':
            // Send message to channel or user
            if (words.length < 3) {
                bot.notice(from, 'Syntax: @say <channel/nick> <message>');
                return false;
            }

            bot.say(words[1], words.splice(2).join(' '));
            break;
        case 'do':
            // Send action to channel or user
            if (words.length < 3) {
                bot.notice(from, 'Syntax: @do <channel/nick> <message>');
                return false;
            }

            bot.action(words[1], words.splice(2).join(' '));
            break;
        case 'notice':
            // Send notice to channel or user
            if (words.length < 3) {
                bot.notice(from, 'Syntax: @notice <channel/nick> <message>');
                return false;
            }

            bot.notice(words[1], words.splice(2).join(' '));
            break;
        case 'whois':
            // Request whois on user
            if (words.length != 2) {
                bot.notice(from, 'Syntax: @whois <nick>');
                return false;
            }

            bot.whois(words[1], function (info) {
                console.log(util.inspect(info));
            });
            break;
        case 'addautojoin':
            if (words.length != 2 || words[1].length === 0) {
                bot.notice(from, 'Syntax: @addautojoin <channel>');
                return false;
            }

            chName = words[1].toLowerCase();

            chan = store.channels.find(function (ch) {
                return ch.channel == chName;
            });

            if (chan === undefined) {
                bot.notice(from, chName + ' is not a registered channel');
                return false;
            }

            chan.autojoin = 1;
            db.run('UPDATE channels SET autojoin = 1 WHERE id = ?', chan.id);

            bot.notice(from, 'Will autojoin ' + chName + ' from now on');
            break;
        case 'deleteautojoin':
            if (words.length != 2 || words[1].length === 0) {
                bot.notice(from, 'Syntax: @deleteautojoin <channel>');
                return false;
            }

            chName = words[1].toLowerCase();

            chan = store.channels.find(function (ch) {
                return ch.channel == chName;
            });

            if (chan === undefined) {
                bot.notice(from, chName + ' is not a registered channel');
                return false;
            }

            chan.autojoin = 0;
            db.run('UPDATE channels SET autojoin = 0 WHERE id = ?', chan.id);

            bot.notice(from, 'Will NOT autojoin ' + chName + ' from now on');
            break;
        case 'chanlist':
            /**
             * Client.chans object format
             *
             * {
             *     channel: {
             *         key: channel,
             *         serverName: channel,
             *         users: {
             *             nick: access
             *         },
             *         modeParams: {},
             *         mode: +npstz,
             *         topic: topic,
             *         topicBy: nick!user@host,
             *         created: unix timestamp
             *     }
             * }
             *
             * access list:
             * ~ owner
             * & sop
             * @ op
             * % hop
             * + voice
             */

            console.log(util.inspect(bot.chans, false, null));
            break;
        case 'adduser':
            if (words.length != 3 || words[1].length === 0 || words[2].length === 0) {
                bot.notice(from, 'Syntax: @adduser <nick> <orderset>');
                return false;
            }

            os = store.ordersets.find(function (os) {
                return os.name == words[2];
            });

            if (os === undefined) {
                bot.notice(from, words[2] + ' is not a registered orderset');
                return false;
            }

            osid = os.id;

            u = store.users.find(function (u) {
                return u.nick == words[1];
            });

            if (u === undefined) {
                db.run('INSERT INTO users (`nick`) VALUES (?)', words[1], function (err) {
                    uid = this.lastID;
                    store.users.push({id: uid, nick: words[1]});

                    store.orderset_users.push({orderset_id: osid, user_id: uid});

                    db.run('INSERT INTO orderset_users (`orderset_id`, `user_id`) VALUES (?, ?)', osid, uid);
                    bot.notice(from, words[1] + ' added as user to the ' + words[2] + ' orderset');
                });
            } else {
                uid = u.id;
                store.users.push({id: uid, nick: words[1]});

                store.orderset_users.push({orderset_id: osid, user_id: uid});

                db.run('INSERT INTO orderset_users (`orderset_id`, `user_id`) VALUES (?, ?)', osid, uid);
                bot.notice(from, words[1] + ' added as user to the ' + words[2] + ' orderset');
            }
            break;
        case 'deleteuser':
            if (words.length != 3 || words[1].length === 0 || words[2].length === 0) {
                bot.notice(from, 'Syntax: @deleteuser <nick> <orderset>');
                return false;
            }

            os = store.ordersets.find(function (os) {
                return os.name == words[2];
            });

            if (os === undefined) {
                bot.notice(from, words[2] + ' is not a registered orderset');
                return false;
            }

            osid = os.id;

            u = store.users.find(function (u) {
                return u.nick == words[1];
            });

            if (u === undefined) {
                bot.notice(from, words[1] + ' is not a registered user');
                return false;
            }

            uid = u.id;

            var ou = store.orderset_users.findIndex(function (ou) {
                return ou.orderset_id == osid && ou.user_id == uid;
            });

            if (ou == -1) {
                bot.notice(from, words[1] + ' is not assigned to the ' + words[2] + ' orderset');
                return false;
            }

            store.orderset_users.splice(ou, 1);
            db.run('DELETE FROM orderset_users WHERE orderset_id = ? AND user_id = ?', osid, uid);
            bot.notice(from, words[1] + ' user removed from the ' + words[2] + ' orderset');
            break;
        case 'listusers':
            if (words.length != 2 || words[1].length === 0) {
                bot.notice(from, 'Syntax: @listusers <orderset>');
                return false;
            }

            os = store.ordersets.find(function (orderset) {
                return orderset.name == words[1];
            });

            if (os === undefined) {
                bot.notice(from, words[1] + ' is not a registered orderset');
                return false;
            }

            var uIDArr = store.orderset_users.filter(function (ou) {
                return ou.orderset_id == os.id;
            }).map(function (ou) {
                return ou.user_id;
            });

            var userArr = store.users.filter(function (user) {
                return uIDArr.indexOf(user.id) > -1;
            }).map(function (user) {
                return user.nick;
            });

            if (userArr.length === 0) {
                bot.notice(from, 'There are no users assigned to the ' + words[1] + ' orderset');
                return false;
            }

            bot.notice(from, 'Users in orderset ' + words[1] + ': ' + userArr.join(', '));
            break;
        case 'addchan':
            if (words.length != 3 || words[1].length === 0 || words[2].length === 0) {
                bot.notice(from, 'Syntax: @addchan <channel> <orderset>');
                return false;
            }

            os = store.ordersets.find(function (os) {
                return os.name == words[2];
            });

            if (os === undefined) {
                bot.notice(from, words[2] + ' is not a registered orderset');
                return false;
            }

            osid = os.id;

            ch = store.channels.find(function (ch) {
                return ch.channel == words[1].toLowerCase();
            });

            if (ch === undefined) {
                db.run('INSERT INTO channels (`channel`) VALUES (?)', words[1], function (err) {
                    chid = this.lastID;

                    store.channels.push({id: chid, channel: words[1].toLowerCase()});
                    store.orderset_channels.push({orderset_id: osid, channel_id: chid});

                    db.run('INSERT INTO orderset_channels (`orderset_id`, `channel_id`) VALUES (?, ?)', osid, chid);
                    bot.notice(from, words[1] + ' channel added to ' + words[2] + ' orderset');
                });
            } else {
                chid = ch.id;

                store.orderset_channels.push({orderset_id: osid, channel_id: chid});

                db.run('INSERT INTO orderset_channels (`orderset_id`, `channel_id`) VALUES (?, ?)', osid, chid);
                bot.notice(from, words[1] + ' channel added to ' + words[2] + ' orderset');
            }
            break;
        case 'deletechan':
            if (words.length != 3 || words[1].length === 0 || words[2].length === 0) {
                bot.notice(from, 'Syntax: @deletechan <channel> <orderset>');
                return false;
            }

            os = store.ordersets.find(function (os) {
                return os.name == words[2];
            });

            if (os === undefined) {
                bot.notice(from, words[2] + ' is not a registered orderset');
                return false;
            }

            osid = os.id;

            ch = store.channels.find(function (ch) {
                return ch.channel == words[1].toLowerCase();
            });

            if (ch === undefined) {
                bot.notice(from, words[1] + ' is not a registered channel');
                return false;
            }

            chid = ch.id;

            var oc = store.orderset_channels.findIndex(function (oc) {
                return oc.orderset_id == osid && oc.channel_id == chid;
            });

            if (oc == -1) {
                bot.notice(from, words[1] + ' is not assigned to the ' + words[2] + ' orderset');
                return false;
            }

            store.orderset_channels.splice(oc, 1);
            db.run('DELETE FROM orderset_channels WHERE orderset_id = ? AND channel_id = ?', osid, chid);
            bot.notice(from, words[1] + ' channel removed from the ' + words[2] + ' orderset');
            break;
        case 'listchans':
            if (words.length != 2 || words[1].length === 0) {
                bot.notice(from, 'Syntax: @listchans <orderset>');
                return false;
            }

            os = store.ordersets.find(function (orderset) {
                return orderset.name == words[1];
            });

            if (os === undefined) {
                bot.notice(from, words[1] + ' is not a registered orderset');
                return false;
            }

            var chIDArr = store.orderset_channels.filter(function (och) {
                return och.orderset_id == os.id;
            }).map(function (och) {
                return och.channel_id;
            });

            var chanArr = store.channels.filter(function (channel) {
                return chIDArr.indexOf(channel.id) > -1;
            }).map(function (channel) {
                return channel.channel;
            });

            if (chanArr.length === 0) {
                bot.notice(from, 'No channels assigned to orderset ' + words[1]);
                return false;
            }

            bot.notice(from, 'Channels in ' + words[1] + ' orderset: ' + chanArr.join(', '));
            break;
        case 'addadmin':
            if (words.length != 2 || words[1].length === 0) {
                bot.notice(from, 'Syntax: @addadmin <nick>');
                return false;
            }

            if (store.admins.find(function (admin) { return admin.nick == words[1]; }) !== undefined) {
                bot.notice(words[1] + ' is already an admin.');
                return false;
            }

            store.admins.push({nick: words[1]});
            db.run('INSERT INTO admins (`nick`) VALUES (?)', words[1]);
            bot.notice(from, words[1] + ' added to admins');
            break;
        case 'deleteadmin':
            if (words.length != 2 || words[1].length === 0) {
                bot.notice(from, 'Syntax: @deleteadmin <nick>');
                return false;
            }

            if (store.admins.find(function (admin) { return admin.nick == words[1]; }) === undefined) {
                bot.notice(words[1] + ' is not a registered admin.');
                return false;
            }

            store.admins.splice(store.admins.findIndex(function (admin) { return admin.nick == words[1]; }), 1);
            db.run('DELETE FROM admins WHERE nick = ?', words[1]);
            bot.notice(from, words[1] + ' removed from admins');
            break;
        case 'listadmins':
            if (words.length != 1) {
                bot.notice(from, 'Syntax: @listadmins');
                return false;
            }

            var adminArr = store.admins.map(function (admin) {
                return admin.nick;
            });

            if (adminArr.length === 0) {
                bot.notice(from, 'No admins registered');
                return false;
            }

            bot.notice(from, 'Admins: ' + adminArr.join(', '));
            break;
        case 'addorderset':
            if (words.length != 2 || words[1].length === 0) {
                bot.notice(from, 'Syntax: @addorderset <orderset>');
                return false;
            }

            // Don't allow 'update' as prefix of orderset name
            if (words[1].substr(0, 6) == 'update') {
                bot.notice(from, 'The word "update" can\'t be the prefix of orderset names');
                return false;
            }

            os = store.ordersets.find(function (os) {
                return os.name == words[1];
            });

            if (os !== undefined) {
                bot.notice(from, words[1] + ' is already a registered orderset');
                return false;
            }

            db.run('INSERT INTO ordersets (`name`) VALUES (?)', words[1], function (err) {
                osid = this.lastID;
                store.ordersets.push({name: words[1], id: osid});
                bot.notice(from, words[1] + ' added to ordersets');
            });
            break;
        case 'deleteorderset':
            if (words.length != 2 || words[1].length === 0) {
                bot.notice(from, 'Syntax: @deleteorderset <orderset>');
                return false;
            }

            os = store.ordersets.findIndex(function (os) {
                return os.name == words[1];
            });

            if (os === -1) {
                bot.notice(from, words[1] + ' is not a registered orderset');
                return false;
            }

            osid = store.ordersets[os].id;

            db.run('DELETE FROM orderset_channels WHERE orderset_id = ?', osid);
            db.run('DELETE FROM orderset_users WHERE orderset_id = ?', osid);
            db.run('DELETE FROM orders WHERE orderset_id = ?', osid);
            db.run('DELETE FROM ordersets WHERE id = ?', osid);

            store.orderset_channels = store.orderset_channels.filter(function (och) {
                return och.orderset_id != osid;
            });

            store.orderset_users = store.orderset_users.filter(function (ou) {
                return ou.orderset_id != osid;
            });

            store.orders = store.orders.filter(function (o) {
                return o.orderset_id != osid;
            });

            store.ordersets.splice(os, 1);

            bot.notice(from, words[1] + ' removed from ordersets');
            break;
        case 'listordersets':
            if (words.length != 1) {
                bot.notice(from, 'Syntax: @listordersets');
                return false;
            }

            var osArr = store.ordersets.map(function (os) {
                return os.name;
            });

            if (osArr.length === 0) {
                bot.notice(from, 'No ordersets registered');
                return false;
            }

            bot.notice(from, 'Ordersets: ' + osArr.join(', '));
            break;
        default:
            // Unreachable
            return false;
    }
}

// Handle order commands
function handleOrderCommand(args) {
    // Extract encapsulated args
    var from = args[0];
    var to = args[1];
    var text = args[2];
    var message = args[3];

    var words = text.split(' ');
    var command = words[0].substr(1).toLowerCase();
    var oName;
    var os;

    // Update?
    if (command.substr(0, 6) == 'update') {
        if (words.length < 2 || words.length > 5) {
            bot.notice(from, 'Syntax: @update<orderset> <priority> <region> <link> <optional info>');
            bot.notice(from, 'Syntax: @update<orderset> clear <optional prio>');
            return false;
        }

        oName = command.substr(6);
        command = words[1].toLowerCase();

        if (oName.length === 0) {
            bot.notice(from, 'Syntax: @update<orderset> <priority> <region> <link> <optional info>');
            bot.notice(from, 'Syntax: @update<orderset> clear <optional prio>');
            return false;
        }

        // Get orderset
        os = store.ordersets.find(function (os) {
            return os.name == oName;
        });

        if (os === undefined) {
            bot.notice(from, oName + ' is not a registered orderset');
            return false;
        }

        // Check if the user is allowed to update this orderset
        var u = store.users.find(function (u) {
            return u.nick == from;
        });

        if (u === undefined) {
            bot.notice(from, 'You are not allowed to update this orderset.');
            return false;
        }

        // Check if user can modify orderset
        var ou = store.orderset_users.find(function (ou) {
            return ou.orderset_id == os.id && ou.user_id == u.id;
        });

        if (ou === undefined) {
            bot.notice(from, 'You are not allowed to update this orderset.');
            return false;
        }

        var oid;
        var osid = os.id;
        var prio;

        // Clear orders
        if (command == 'clear') {
            // Clear only one order
            if (words.length == 3) {
                prio = parseInt(words[2]);

                if (prio < 0 || prio > 5 || isNaN(prio)) {
                    bot.notice(from, 'Priority can\'t be greater than 5');
                    return false;
                }

                oid = store.orders.findIndex(function (o) {
                    return o.orderset_id == osid && o.priority == prio;
                });

                if (oid == -1) {
                    bot.notice(from, 'No order with priority ' + prio + ' in orderset ' + oName);
                    return false;
                }

                db.run('DELETE FROM orders WHERE orderset_id = ? AND priority = ?', osid, prio);
                store.orders.splice(oid, 1);

                bot.notice(from, 'Priority ' + prio + ' cleared from orderset ' + oName);
            } else {
                db.run('DELETE FROM orders WHERE orderset_id = ?', osid);
                store.orders = store.orders.filter(function (o) {
                    return o.orderset_id != osid;
                });

                bot.notice(from, 'Orderset ' + oName + ' cleared');
            }
        } else {
            // Update one order

            // Check parameter count
            if (words.length < 4) {
                bot.notice(from, 'Correct syntax: @update<orderset> <priority> <region> <link> <optional info>');
                return false;
            }

            prio = parseInt(command);
            var region = words[2];
            var link = words[3];
            var info = (words.length == 5 ? words[4] : '');

            // Check parameter lengths
            if (prio > 5 || prio < 1 || isNaN(prio) || region.length > 64 || link.length > 64 || info.length > 64) {
                bot.notice(from, 'Priority can\'t be greater than 5, region name, link and info length can\'t be greater than 64');
                return false;
            }

            oid = store.orders.findIndex(function (o) {
                return o.priority == prio && o.orderset_id == osid;
            });

            if (oid > -1) {
                store.orders.splice(oid, 1);
                db.run('DELETE FROM orders WHERE priority = ? AND orderset_id = ?', prio, osid);
            }

            db.run('INSERT INTO orders (`orderset_id`, `priority`, `region`, `link`, `info`) VALUES (?, ?, ?, ?, ?)', osid, prio, region, link, info);

            store.orders.push({
                orderset_id: osid,
                priority: prio,
                region: region,
                link: link,
                info: info
            });

            bot.notice(from, 'Order updated');
        }
    } else {
        // Order listing?
        oName = command;

        os = store.ordersets.find(function (os) {
            return os.name == oName;
        });

        if (os === undefined) {
            bot.notice(from, oName + ' is not a registered orderset');
            return false;
        }

        var orders = store.orders.filter(function (o) {
            return o.orderset_id == os.id;
        });

        if (orders.length === 0) {
            bot.say(to, 'No orders set');
            return false;
        }

        orders.sort(function (a, b) {
            return a.priority - b.priority;
        }).forEach(function (order) {
            bot.say(to, order.priority + '. ' + order.region + ' - ' + order.link + (order.info.length > 0 ? ' - ' + order.info : ''));
        });
    }

}

// Handle secondary commands (starting with !)
function handleSecondaryCommand(from, to, text, message) {
    var words = text.split(' ');
    var command = words[0].substr(1).toLowerCase();

    switch (command) {
        case 'all':
            // HOP or above
            if (accessLevel(to, from) > 1) {
                var nicks = [];
                for (var nick in bot.chans[to].users) {
                    nicks.push(nick);
                }

                bot.say(to, nicks.join(', '));
            }
            break;
    }
}

function handleNickServ(from, to, text, message) {
    var words = text.split(' ');
    if (words[0].toLowerCase() == 'status') {
        var uid = store.users_status.findIndex(function (u) {
            return u.nick == words[1];
        });

        if (uid == -1) {
            store.users_status.push({nick: words[1], status: words[2]});
        } else {
            store.users_status[uid].status = words[2];
        }

        // Whether we need to call the callback function
        if (waitingForNickServ) {
            // Set global flag
            waitingForNickServ = false;

            // Callback if admin
            if (words[2] == 3) {
                nickServCallback(nickServArgs);
            }
        }
    }
}

function updateNick() {
    bot.send('NICK', store.botConfig.nick);
}

function identifyBot() {
    bot.say('NickServ', 'identify ' + store.botConfig.nickservPassword);
}

function accessLevel(channel, nick) {
    switch (bot.chans[channel.toLowerCase()].users[nick]) {
        case '~':
            // Owner
            return 5;
        case '&':
            // SOP
            return 4;
        case '@':
            // OP
            return 3;
        case '%':
            // HOP
            return 2;
        case '+':
            // Voice
            return 1;
        default:
            return 0;
    }
}
