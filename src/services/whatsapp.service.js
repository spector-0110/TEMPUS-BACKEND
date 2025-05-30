const ultramsg = require('ultramsg-whatsapp-api');

const instance_id= process.env.INSTANCE_ID 
const ultramsg_token=process.env.ULTRMSG_TOKEN 

const watsappService = new ultramsg(instance_id,ultramsg_token);
// (async function () {
//     var to = "put_your_mobile_number_here"
//     var body = "Hello world" 
//     const response = await api.sendChatMessage(to,body);
//    console.log(response)
// })(); 

module.export =watsappService;