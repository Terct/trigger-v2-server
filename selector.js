const { createClient } = require('@supabase/supabase-js');
const moment = require('moment-timezone');
require('dotenv').config();
const axios = require('axios');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

var interval;

const checkAndFilterUsers = async () => {
    try {
        const { data: allUsers, error } = await supabase
            .from('dp-v2-users')
            .select('*');

        if (error) {
            throw error;
        }

        const usersWithActivatedTrigger = allUsers.filter(user => {
            const userProfile = user.user_profile?.triggerForList?.status;
            return userProfile === 'Ativado';
        });

        for (const user of usersWithActivatedTrigger) {
            const userId = user.id;

            const { data: userTriggers, error: triggerError } = await supabase
                .from('dp-v2-trigger')
                .select('*')
                .eq('user_id', userId)
                .eq('trigger_status', false)
                .limit(1);

            if (triggerError) {
                throw triggerError;
            }

            const profile = user.user_profile
            const typeInterval = profile.triggerForList.labelIntervalSelected

            if (typeInterval === "Fixo") {

                interval = profile.triggerForList.intervalSelected

                interval = parseInt(interval)

            } else {
                // Se não for "Fixo", e o intervalo for do formato "min-max"
                if (profile.triggerForList.intervalSelected.includes("-")) {
                    const [min, max] = profile.triggerForList.intervalSelected.split("-").map(Number);

                    // Gere um número aleatório entre min e max (inclusive)
                    interval = Math.floor(Math.random() * (max - min + 1)) + min;
                } else {
                    // Lógica para lidar com outros formatos, se necessário
                    console.error("Formato de intervalo não suportado");
                }
            }

            //console.log(interval)


            if (userTriggers[0]) {
                const triggerItemId = userTriggers[0].message_id;

                if (
                    user.last_time_trigger === null ||
                    moment().diff(moment(user.last_time_trigger), 'minutes') >= interval
                ) {
                    try {
                        const response = await axios.post('http://localhost:61518/triggerItemForList', {
                            item: userTriggers[0],
                            // Adicione quaisquer outros dados necessários no corpo da requisição
                        });

                        if (response.status === 200) {

                            //console.log(response.data.message.extendedTextMessage.text)

                            if(!response.data.typebot){

                                var sendMessage = response.data.message.extendedTextMessage.text

                            }else{

                                var sendMessage = "Fluxo do Typebot"

                            }

                            

                            const { data: updateData, error: updateError } = await supabase
                                .from('dp-v2-trigger')
                                .update({ trigger_status: true, content_message: sendMessage, shipping_time: moment() })
                                .eq('message_id', triggerItemId);

                            if (updateError) {
                                throw updateError;
                            }

                            const { data: updateTimeData, error: updateTimeError } = await supabase
                                .from('dp-v2-users')
                                .update({ last_time_trigger: moment().toISOString() })
                                .eq('id', userId);

                            if (updateTimeError) {
                                throw updateTimeError;
                            }
                        } else {
                            console.error('Erro ao fazer a requisição para a rota triggerItemForList:', response.statusText);
                        }
                    } catch (axiosError) {
                        //console.log(axiosError)
                        console.error('Erro ao fazer a requisição para a rota triggerItemForList:', axiosError.message);

                        if (
                            axiosError.response.data === "Connection Closed" ||
                            axiosError.response.data === "Todas falharam"
                        ) {
                            const { data: updateData, error: updateError } = await supabase
                                .from('dp-v2-users')
                                .update({ counter_critical_error: user.counter_critical_error + 1 })
                                .eq('id', userId);

                            if (updateError) {
                                throw updateError;
                            }
                        }
                        else if (axiosError.response.data === "Error Desconhecido") {


                            const { data: updateData, error: updateError } = await supabase
                                .from('dp-v2-trigger')
                                .update({ trigger_status: true, error: true, content_error: "Error: Mensagem não enviada!", shipping_time: moment() })
                                .eq('message_id', triggerItemId);

                            if (updateError) {
                                throw updateError;
                            }

                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('Erro ao verificar e filtrar usuários:', error);
    }
};

checkAndFilterUsers();

setInterval(() => {
    checkAndFilterUsers();
}, 60000);
