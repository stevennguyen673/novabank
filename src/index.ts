import app from "./api/app";

app.listen(process.env.PORT || 3000, () => {console.log('Server Started Successfully')})