var fs = require('fs');

// Delete database file
try {
    fs.unlinkSync('nodejsirc.db');
    console.log('Database deleted.');
} catch(e) {
    console.log('Database didnt exist.');
}

var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('nodejsirc.db');


// Create tables
db.run('CREATE TABLE config (key VARCHAR(64), value VARCHAR(64))');
db.run('CREATE TABLE ordersets (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(64))');
db.run('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, nick VARCHAR(64))');
db.run('CREATE TABLE channels (id INTEGER PRIMARY KEY AUTOINCREMENT, channel VARCHAR(64), autojoin INTEGER DEFAULT 0)');
db.run('CREATE TABLE admins (nick VARCHAR(64))');
db.run('CREATE TABLE orderset_users (orderset_id INTEGER, user_id INTEGER)');
db.run('CREATE TABLE orderset_channels (orderset_id INTEGER, channel_id INTEGER)');
db.run('CREATE TABLE orders (orderset_id INTEGER, priority INTTEGER, region VARCHAR(64), link VARCHAR(64), info VARCHAR(64))');

console.log('Database created.');

setTimeout(function () {
    db.run('INSERT INTO admins (`nick`) VALUES ("sugarfree"), ("oblige")');
    db.run('INSERT INTO channels (`channel`, `autojoin`) VALUES ("#whalebot", 1)');

    // Config
    db.run('INSERT INTO config (`key`, `value`) VALUES ("nick", "WhaleBot"), ("userName", "WhaleBot"), ("realName", "WhaleBot"), ("nickservPassword", "123456")');

    console.log('Tables populated with default values');
}, 500);
