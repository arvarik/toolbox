fetch("http://localhost:3100/api/chat/starters?pillarId=system-design&topicId=distributed-systems")
  .then(res => res.text())
  .then(text => console.log("Response:", text))
  .catch(err => console.error(err));
