const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const dbPath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

// API 1 create user

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = ${username};`;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUserQuery = `
            INSERT INTO 
            user (username, password, name, gender)
            VALUES ('${username}', '${hashedPassword}', '${name}', '${gender}')`;
      await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// API 2    login

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = ${username};`;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser !== undefined) {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);

    if (isPasswordMatched === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

// Authentication with JWT Token

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];

  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }

  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        next();
      }
    });
  }
};

// API 3 Returns the latest tweets of people whom the user follows. Return 4 tweets at a time

const getTheFollowingPeopleQuery = async (username) => {
  const followingPeopleQuery = `
        SELECT following_user_id FROM follower
        INNER JOIN user ON user.user_id = follower.follower_user_id
        WHERE user.username = ${username};`;

  const followingPeople = await db.all(followingPeopleQuery);
  const arrayOfIds = followingPeople.map(
    (eachUser) => eachUser.following_user_id
  );
  return arrayOfIds;
};

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;

  const followingPeopleIds = await getTheFollowingPeopleQuery(username);

  const getTweetsQuery = `
    SELECT username, tweet, date_time AS dateTime
    FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
    WHERE 
    user.user_id IN (${followingPeopleIds})
    ORDER BY date_time DESC
    LIMIT 4;`;

  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

//API 4 Returns the list of all names of people whom the user follows

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const getFollowingUsersQuery = `
    SELECT name FROM follower 
    INNER JOIN user ON user.user_id = follower.following_user_id
    WHERE follower_user_id = '${userId}';`;

  const peopleNames = await db.all(getFollowingUsersQuery);
  response.send(peopleNames);
});

//API 5     Returns the list of all names of people who follows the user

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const getFollowerQuery = `
    SELECT  DISTINCT name FROM follower 
    INNER JOIN user ON user.user_id = follower.follower_user_id
    WHERE following_user_id = '${userId}';`;

  const followers = await db.all(getFollowerQuery);
  response.send(followers);
});

//API 6     tweets

const tweetAccessVerification = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request;
  const getTweetQuery = `
        SELECT * FROM 
        tweet INNER JOIN follower
        ON tweet.user_id = follower.following_user_id
        WHERE tweet.tweet_id = ${tweetId} AND follower_user_id = ${userId};`;
  const tweet = await db.get(getTweetQuery);

  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { userId, username } = request;
    const { tweetId } = request.params;
    const getTweetQuery = `
    SELECT tweet,
    (SELECT COUNT() FROM like WHERE tweet_id = '${tweetId}') AS likes,
    (SELECT COUNT() FROM reply WHERE tweet_id = '${tweetId}') AS replies,
    date_time AS dateTime
    FROM tweet
    WHERE tweet.tweet_id = '${tweetId}';`;

    const tweet = await db.get(getTweetQuery);
    response.send(tweet);
  }
);

//API 7         /tweets/:tweetId/likes/

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQueries = `
       SELECT username FROM 
       user INNER JOIN like 
       ON user.user_id = like.user_id
        WHERE tweet_id = '${tweetId}';`;
    const likedUser = await db.all(getLikesQueries);
    const userArray = likedUser.map((eachUser) => eachUser.username);
    response.send({ likes: userArray });
  }
);

// API 8        If the user requests a tweet of a user he is following, return the list of replies.

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliedQuery = `
       SELECT name, reply 
       FROM user INNER JOIN reply ON user.user_id = reply.user_id
       WHERE tweet_id = '${tweetId}';`;
    const repliedUsers = await db.all(getRepliedQuery);
    response.send({ replies: repliedUsers });
  }
);

// API 9    Returns a list of all tweets of the user

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const getTweetQuery = `
        SELECT tweet,
        COUNT(DISTINCT like_id) AS likes,
        COUNT(DISTINCT reply_id) AS replies,
        date_time AS dateTime
        FROM tweet LEFT JOIN ON
        tweet.tweet_id = reply.tweet_id
        LEFT JOIN  like ON
        tweet.tweet_id = like.tweet_id
        WHERE tweet.user_id = ${userId}
        GROUP BY tweet.tweet_id;`;
  const tweets = await db.all(getTweetQuery);
  response.send(tweets);
});

//API - 10          Create a tweet in the tweet table

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const userId = parseInt(request.userId);
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const createTweetQuery = `
    INSERT INTO tweet
    (tweet, user_id, date_time)
    VALUES ('${tweet}', '${userId}', '${dateTime}');`;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

// API 11   If the user deletes his tweet

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { userId } = request.body;
    const getTheTweetQuery = `
    SELECT * FROM tweet WHERE user_id = ${userId} AND tweet_id = ${tweet_id}'`;
    console.log(tweet);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = '${tweet_id}';`;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
