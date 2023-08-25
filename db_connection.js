const mysql = require('mysql')

const pool = new mysql.createConnection({
    user: 'admin',
    password: 'admin',
    host: 'localhost',
    database: 'tiktok_live'
})

pool.connect(function (err) {
    if (err) throw err;
    console.log("Connected!");
});

module.exports = {
    pool
}