const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();
const moment = require('moment-timezone');
const fs = require('fs').promises;
const axios = require('axios');
const { profile } = require('console');
const cheerio = require('cheerio');


const selector = require('./selector.js')
const creatLogs = require('./creatLogs.js')


const app = express();
const port = 61518

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(bodyParser.json());


// Função para converter mensagem HTML para JSON
function htmlToJSON(html) {
  // Verifica se o input contém tags HTML
  if (/<[a-z][\s\S]*>/i.test(html)) {


    const $ = cheerio.load(html);

    // Extrair o conteúdo dentro de cada <p>
    const paragraphs = $('p').map((index, element) => {
      const paragraphText = $(element).find('strong').map((idx, strong) => {
        return '*' + $(strong).text().trim() + '*';
      }).get().join(' ');

      // Substituir <strong> por *
      const paragraphContent = $(element).html().replace(/<strong\s*[/]?>/gi, '*').replace(/<\/strong\s*[/]?>/gi, '*').replace(/<br\s*[/]?>/gi, '\n');

      return paragraphContent;
    }).get();

    // Formatar os textos em um array de objetos JSON
    const jsonMessages = paragraphs.map(paragraphText => {
      return { type: 'text', content: paragraphText };
    });


    return jsonMessages;

  } else {

    // Se não contiver tags HTML, cria um JSON com o conteúdo diretamente
    return [{ type: 'text', content: html }];

  }


}

async function saveLog(userId, name, telephone, triggerStatus, error, contentError, contentMessage, shippingTime, typeTrigger) {
  try {
    // Insira aqui o código para acessar a tabela dp-v2-logs e criar uma nova linha com os parâmetros fornecidos
    const { data: insertedLog, error: insertionError } = await supabase
      .from('dp-v2-logs')
      .insert([{
        user_id: userId,
        created_at: new Date(),
        name: name,
        telephone: telephone,
        trigger_status: triggerStatus,
        error: error,
        content_error: contentError,
        content_message: contentMessage,
        shipping_time: shippingTime,
        typeTrigger: typeTrigger
      }]);

    if (insertionError) {
      throw insertionError;
    }

    return { message: 'Log salvo com sucesso' };
  } catch (error) {
    console.error('Erro ao salvar log:', error);
    throw { error: 'Erro interno no servidor ao salvar log' };
  }
}


app.post('/webhook-test-event/', async (req, res) => {
  try {


    const evolutionUrl = process.env.EVOLUTION_API_URL;
    const evolutionKey = process.env.EVOLUTION_API_KEY;


    const { webhookId, number, messageType, messageSelected, instance } = req.body;

    // Consultar a tabela dp-v2-users para obter dados associados ao user_id
    const { data: userData, error: userError } = await supabase
      .from('dp-v2-users')
      .select('*')
      .eq('webhook_id', webhookId)
      .single();

    // Verificar se a consulta retornou resultados
    if (userData) {


      if (messageType === "Mensagem") {

        const message = htmlToJSON(messageSelected);

        //console.log(message)


        try {
          // Se fluxo for igual a false, fazer a requisição Axios
          await axios.post(`${evolutionUrl}/message/sendText/${instance}`, {
            number: `${number}@s.whatsapp.net`,
            options: {
              delay: 1200,
              presence: 'composing',
              linkPreview: false
            },
            textMessage: {
              text: message[0].content
            }
          }, {
            headers: {
              'Content-Type': 'application/json',
              'apikey': evolutionKey
            }
          })
            .then(response => {

              console.log('Resposta da requisição:', response.data);
              res.status(200).json({ "message": "Enviado com sucesso!" });

            })

        } catch (axiosError) {
          console.error('Erro na requisição Axios:', axiosError.response);
          //res.status(200).json({"message": "Teste não enviado"});
          throw axiosError; // Rejeitar o erro para o bloco catch externo

        }


      }


    } else {
      console.log('Nenhum usuário encontrado para o webhook:', webhookId);
    }

  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});



app.post('/webhook/:webhookId', async (req, res) => {
  try {
    const { webhookId } = req.params;
    const body = req.body;

    // Consultar a tabela dp-v2-users para obter dados associados ao user_id
    const { data: userData, error: userError } = await supabase
      .from('dp-v2-users')
      .select('*')
      .eq('webhook_id', webhookId)
      .single();

    // Verificar se a consulta retornou resultados
    if (userData) {
      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;

      var events = userData.user_profile.triggerForEventos.events
      var lastLine = userData.last_line
      const counter_erros = userData.counter_critical_error
      const typeShot = userData.user_profile.triggerForEventos.labelTypeOfShot
      const typeMessage = userData.user_profile.triggerForEventos.labelMessageType
      var loop = false
      var line;
      var urlAxios;

      var selectedEvents = userData.user_profile.triggerForEventos.eventsSelecteds

      const filteredEvents = events.filter(event => {
        return selectedEvents.includes(event.name);
      });

      events = filteredEvents

      //console.log(events)

      if (userData.user_profile.triggerForEventos.status === "Ativado") {

        if (typeShot === "Randomico") {
          loop = true
          line = userData.user_evolution_instances
        } else {
          line = userData.user_profile.triggerForEventos.lineSelected
        }

        if (typeMessage === "Mensagem") {
          urlAxios = `${evolutionUrl}/message/sendText/`
        } else {
          urlAxios = `${evolutionUrl}/typebot/start/`
        }

        // Array para armazenar informações dos itens que correspondem à condição
        const matchedItems = [];

        // Loop através dos eventos
        for (let i = 0; i < events.length; i++) {
          const event = events[i];
          const conditionIdentifier = event.conditionIdentifier;
          const conditionValue = event.conditionValue;
          let number = event.number;
          let text = event.text;

          // Se o texto contiver variáveis delimitadas por chaves, substitua-as pelos valores correspondentes no corpo da requisição
          const matches = text.match(/{(.*?)}/g);
          if (matches) {
            for (const match of matches) {
              const variableName = match.substring(1, match.length - 1);
              if (body.hasOwnProperty(variableName)) {
                text = text.replace(match, body[variableName]);
              }
            }
          }

          // Se o número está associado a algum identificador específico no corpo da requisição, atribua o valor correspondente
          if (body.hasOwnProperty(number)) {
            number = body[number];
          }

          // Verificar se o conditionIdentifier está presente no corpo da requisição
          if (body.hasOwnProperty(conditionIdentifier)) {
            // Comparar os valores
            if (body[conditionIdentifier] == conditionValue) {
              console.log(`O valor de ${conditionIdentifier} é igual a ${conditionValue}`);
              // Armazenar informações do item correspondente
              matchedItems.push({
                index: i,
                number: number,
                text: text
              });
            } else {
              //console.log(`O valor de ${conditionIdentifier} não é igual a ${conditionValue}`);
            }
          } else if (conditionValue === '' && conditionIdentifier === '') {
            // Se conditionValue e conditionIdentifier estiverem vazios, adicione as informações do item
            matchedItems.push({
              index: i,
              number: number,
              text: text
            });
          } else {
            //console.log(`O corpo da requisição não contém ${conditionIdentifier}`);
          }
        }

        if (matchedItems.length === 0) {
          saveLog(userData.id, "***", 0, true, true, "Evento Desconhecido, o evento não se encaixa em nenhum evento", "***", moment().toISOString(), "Disparador por Eventos");
          res.status(200).json({ "Message": "Evento desconhecido" });
          return;
        }

        //console.log("Itens que correspondem à condição:", matchedItems);
        let messageSelected = htmlToJSON(matchedItems[0].text)
        //console.log(messageSelected)


        if (loop) {


          let primaryLine;
          if (lastLine !== null) {
            primaryLine = line.find(item => item.instance === lastLine).instance;
          } else {
            primaryLine = line[0].instance;
          }

          console.log(primaryLine)

          let requestSuccessful = false;
          let allInstancesFailed = false;
          const failedInstances = new Set();
          while (!requestSuccessful && !allInstancesFailed) {
            const nextInstanceIndex = (lastLine !== null) ? (line.findIndex(item => item.instance === lastLine) + 1) % line.length : 0;
            const nextInstance = line[nextInstanceIndex];
            lastLine = nextInstance.instance;
            try {
              console.log(`${urlAxios}${lastLine}`)
              const response = await axios.post(`${urlAxios}${lastLine}`, {
                number: `${matchedItems[0].number}@s.whatsapp.net`,
                options: {
                  delay: 1200,
                  presence: 'composing',
                  linkPreview: false
                },
                textMessage: {
                  text: messageSelected[0].content
                }
              }, {
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': evolutionKey
                },
                timeout: 10000 // Definindo o tempo limite como 10 segundos (10000 milissegundos)
              });

              console.log('Resposta da requisição:', response.data);
              requestSuccessful = true;


              const { data: updateData, error: updateError } = await supabase
                .from('dp-v2-users')
                .update({ last_line: lastLine })
                .eq('id', userData.id);

              if (updateError) {
                throw updateError;
              }

              saveLog(userData.id, "***", matchedItems[0].number, true, false, null, messageSelected[0].content, moment().toISOString(), "Disparador por Eventos")
              res.status(200).json({ "Message": "OK" });


            } catch (error) {

              //console.error('Erro na requisição:', error.response.data.response);
              failedInstances.add(lastLine);
              if (failedInstances.size === line.length) {
                allInstancesFailed = true;
              }
            }
          }
          if (allInstancesFailed) {
            console.error('Todas as instâncias foram percorridas e todas falharam');
            if (counter_erros > 2) {
              const updatedUserProfile = {
                ...userData.user_profile,
                triggerForList: {
                  ...userData.user_profile.triggerForEventos,
                  status: 'Desativado'
                }
              };
              supabase
                .from('dp-v2-users')
                .update({ user_profile: updatedUserProfile })
                .eq('id', userData.id)
                .then(() => {
                  console.log(`Status do triggerForList atualizado para "Desativado" para o user_id: ${userData.id}`);
                })
                .catch(updateError => {
                  console.error('Erro ao atualizar o status do triggerForList:', updateError);
                  res.status(500).json('Fatal Error');
                });
            } else {


              const { data: updateData, error: updateError } = await supabase
                .from('dp-v2-users')
                .update({ counter_critical_error: userData.counter_critical_error + 1 })
                .eq('id', userData.id);

              if (updateError) {
                throw updateError;
              }

            }
            res.status(400).json("Todas falharam");
          }


        } else {


          try {
            const response = await axios.post(`${urlAxios}${line}`, {
              number: `${matchedItems[0].number}@s.whatsapp.net`,
              options: {
                delay: 1200,
                presence: 'composing',
                linkPreview: false
              },
              textMessage: {
                text: messageSelected[0].content
              }
            }, {
              headers: {
                'Content-Type': 'application/json',
                'apikey': evolutionKey
              },
              timeout: 10000 // Definindo o tempo limite como 10 segundos (10000 milissegundos)
            });

            console.log('Resposta da requisição:', response.data);
            saveLog(userData.id, "***", matchedItems[0].number, true, false, null, messageSelected[0].content, moment().toISOString(), "Disparador por Eventos")
            res.status(200).json(response.data);
          } catch (error) {
            //console.error('Erro na requisição:', error.response);

            if (error.response && error.response.data.response.message === 'Connection Closed') {
              if (counter_erros > 3) {
                const updatedUserProfile = {
                  ...userData.user_profile,
                  triggerForList: {
                    ...userData.user_profile.triggerForEventos,
                    status: 'Desativado'
                  }
                };

                try {
                  await supabase
                    .from('dp-v2-users')
                    .update({ user_profile: updatedUserProfile })
                    .eq('id', userData.id);
                  console.log(`Status do triggerForList atualizado para "Desativado" para o user_id: ${userData.id}`);
                } catch (updateError) {
                  console.error('Erro ao atualizar o status do triggerForList:', updateError);
                  res.status(500).json('Fatal Error');
                }
              } else {
                try {
                  const { data: updateData, error: updateError } = await supabase
                    .from('dp-v2-users')
                    .update({ counter_critical_error: userData.counter_critical_error + 1 })
                    .eq('id', userData.id);

                  if (updateError) {
                    throw updateError;
                  }
                } catch (updateError) {
                  console.error('Erro ao atualizar o contador de erros críticos:', updateError);
                  res.status(500).json('Fatal Error');
                }

              }

              res.status(400).json('Connection Closed');

            } else {
              if (counter_erros > 3) {
                const updatedUserProfile = {
                  ...userData.user_profile,
                  triggerForList: {
                    ...userData.user_profile.triggerForEventos,
                    status: 'Desativado'
                  }
                };

                try {
                  await supabase
                    .from('dp-v2-users')
                    .update({ user_profile: updatedUserProfile })
                    .eq('id', userData.id);
                  console.log(`Status do triggerForList atualizado para "Desativado" para o user_id: ${userData.id}`);
                } catch (updateError) {
                  console.error('Erro ao atualizar o status do triggerForList:', updateError);
                  res.status(500).json('Fatal Error');
                }
              } else {
                try {
                  const { data: updateData, error: updateError } = await supabase
                    .from('dp-v2-users')
                    .update({ counter_critical_error: userData.counter_critical_error + 1 })
                    .eq('id', userData.id);

                  if (updateError) {
                    throw updateError;
                  }
                } catch (updateError) {
                  console.error('Erro ao atualizar o contador de erros críticos:', updateError);
                  res.status(500).json('Fatal Error');
                }
              }
              res.status(500).json('Error Desconhecido');
            }
          }


        }

      } else {
        console.log(`Disparador por Eventos Desativado para ${userData.id}`);
        saveLog(userData.id, "***", matchedItems[0].number, true, true, "Disparador Desativado", messageSelected[0].content, moment().toISOString(), "Disparador por Eventos")
        res.status(200).json({ "Message": "Disparador Desativado" });
      }

    }
    else {
      console.log('Nenhum usuário encontrado para o webhook:', webhookId);
    }

  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});


app.post('/triggerItemForList', async (req, res) => {
  try {
    const { item } = req.body;

    // Consultar a tabela dp-v2-users para obter dados associados ao user_id
    const { data: userData, error: userError } = await supabase
      .from('dp-v2-users')
      .select('*')
      .eq('id', item.user_id)
      .single();

    // Verificar se a consulta retornou resultados
    if (userData) {
      //console.log('Dados do usuário associado ao user_id:', userData);

      const profile = userData.user_profile

      //Ultmo disparo dem timetampstz
      const lastShot = userData.last_shot

      var lastLine = userData.last_line

      const counter_erros = userData.counter_critical_error

      const typeInterval = profile.triggerForList.labelIntervalSelected

      var typebot = profile.triggerForList.typebot

      //var interval;
      var lines = false;
      var line;
      var fluxo = false;
      var message;



      const typeShot = profile.triggerForList.labelTypeOfShot

      if (typeShot === "Randomico") {


        lines = true
        line = userData.user_evolution_instances

      } else {

        line = profile.triggerForList.lineSelected

      }

      const typeMessage = profile.triggerForList.labelMessageType


      if (typeMessage === "Mensagem") {

        //console.log(profile.triggerForList.messagesSelected)

        const randomIndex = Math.floor(Math.random() * profile.triggerForList.messagesSelected.length);
        const selectedMessageCode = profile.triggerForList.messagesSelected[randomIndex];

        const selectedMessage = profile.messages.find(message => message.code === selectedMessageCode);
        if (selectedMessage) {
          message = selectedMessage.value;



          // Converter mensagem HTML para JSON
          const jsonMessages = htmlToJSON(message);
          message = jsonMessages

          console.log(message);



        } else {
          // Mensagem não encontrada para o código selecionado
          message = "Mensagem não encontrada";


        }


      } else {

        fluxo = true
        message = profile.triggerForList.typebot

      }




      //res.status(500).json('Fatal Error');
      //console.log(typeInterval)
      //console.log(typeMessage)
      //console.log(typeShot)
      //console.log(interval)
      //console.log(line)
      //console.log(message)



      //console.log("Um Item entrou na espera! Tempo Estimado:", interval);


      if (!fluxo) {


        const evolutionUrl = process.env.EVOLUTION_API_URL;
        const evolutionKey = process.env.EVOLUTION_API_KEY;


        if (!lines) {

          // Se fluxo for igual a false, fazer a requisição Axios
          axios.post(`${evolutionUrl}/message/sendText/${line}`, {
            number: `${item.telephone}@s.whatsapp.net`,
            options: {
              delay: 1200,
              presence: 'composing',
              linkPreview: false
            },
            textMessage: {
              text: message[0].content
            }
          }, {
            headers: {
              'Content-Type': 'application/json',
              'apikey': evolutionKey
            }
          })
            .then(response => {

              console.log('Resposta da requisição:', response.data);
              res.status(200).json(response.data);

            })

            .catch(error => {
              console.error('Erro na requisição:', error.response.data.response);


              if (error.response.data.response.message === 'Connection Closed') {
                // Verificar se counter_erros é maior que 3 e atualizar o status para "Desativado"
                if (counter_erros > 3) {
                  // Atualizar o status para "Desativado" dentro de triggerForList
                  const updatedUserProfile = {
                    ...userData.user_profile,
                    triggerForList: {
                      ...userData.user_profile.triggerForList,
                      status: 'Desativado'
                    }
                  };

                  // Atualizar o registro no banco de dados
                  supabase
                    .from('dp-v2-users')
                    .update({ user_profile: updatedUserProfile })
                    .eq('id', item.user_id)
                    .then(() => {
                      console.log(`Status do triggerForList atualizado para "Desativado" para o user_id: ${item.user_id}`);
                    })
                    .catch(updateError => {
                      console.error('Erro ao atualizar o status do triggerForList:', updateError);
                      res.status(500).json('Fatal Error');
                    });
                }

                res.status(400).json('Connection Closed');

              } else {

                res.status(500).json('Error Desconhecido');

              }
            });


        }

        // Dentro do seu loop ou onde apropriado
        else {
          let primaryLine;

          if (lastLine !== null) {
            primaryLine = line.find(item => item.instance === lastLine).instance;
          } else {
            primaryLine = line[0].instance;
          }

          // Inicializar uma variável para controlar se a requisição foi bem-sucedida
          let requestSuccessful = false;
          let allInstancesFailed = false;
          const failedInstances = new Set();

          while (!requestSuccessful && !allInstancesFailed) {
            // Encontrar a próxima instância após lastLine ou a primeira se lastLine for null ou o último
            const nextInstanceIndex = (lastLine !== null) ? (line.findIndex(item => item.instance === lastLine) + 1) % line.length : 0;
            const nextInstance = line[nextInstanceIndex];

            // Atualizar lastLine para a próxima instância
            lastLine = nextInstance.instance;

            //console.log(lastLine, primaryLine);

            //console.log('Instância selecionada:', lastLine);

            try {
              // Realizar a requisição Axios
              const response = await axios.post(`${evolutionUrl}/message/sendText/${lastLine}`, {
                number: `${item.telephone}@s.whatsapp.net`,
                options: {
                  delay: 1200,
                  presence: 'composing',
                  linkPreview: false
                },
                textMessage: {
                  text: message[0].content
                }
              }, {
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': evolutionKey
                }
              });

              console.log('Resposta da requisição:', response.data);
              // Definir a variável como true para sair do loop
              requestSuccessful = true;


              const { data: updateData, error: updateError } = await supabase
                .from('dp-v2-users')
                .update({ last_line: lastLine })
                .eq('id', userData.id);

              if (updateError) {
                throw updateError;
              }


              res.status(200).json(response.data);

              //const { data: updateData, error: updateError } = await supabase
              //.from('dp-v2-users')
              //.update({ counter_critical_error: 0 })
              //.eq('id', item.user_id);

              //if (updateError) {
              //throw updateError;
              //}


            } catch (error) {
              console.error('Erro na requisição:', error.response.data);

              // Adicionar a instância atual ao conjunto de instâncias que falharam
              failedInstances.add(lastLine);

              // Verificar se todas as instâncias foram percorridas sem sucesso
              if (failedInstances.size === line.length) {
                allInstancesFailed = true;
              }
            }
          }

          if (allInstancesFailed) {
            console.error('Todas as instâncias foram percorridas e todas falharam');
            // Adicione lógica para retornar código 500 com a mensagem desejada

            if (counter_erros > 2) {
              // Atualizar o status para "Desativado" dentro de triggerForList
              const updatedUserProfile = {
                ...userData.user_profile,
                triggerForList: {
                  ...userData.user_profile.triggerForList,
                  status: 'Desativado'
                }
              };

              // Atualizar o registro no banco de dados
              supabase
                .from('dp-v2-users')
                .update({ user_profile: updatedUserProfile })
                .eq('id', item.user_id)
                .then(() => {
                  console.log(`Status do triggerForList atualizado para "Desativado" para o user_id: ${item.user_id}`);
                })
                .catch(updateError => {
                  console.error('Erro ao atualizar o status do triggerForList:', updateError);
                  res.status(500).json('Fatal Error');
                });
            }


            res.status(400).json("Todas falharam");
          }
        }


      } else {

        const evolutionUrl = process.env.EVOLUTION_API_URL;
        const evolutionKey = process.env.EVOLUTION_API_KEY;


        // Verificar se lines é falso
        if (!lines) {
          // Fazer a requisição GET
          try {
            const instanceResponse = await axios.get(`${evolutionUrl}/instance/fetchInstances?instanceName=${line}`, {
              headers: {
                'Content-Type': 'application/json',
                'apikey': evolutionKey
              }
            });

            const instanceData = instanceResponse.data.instance;

            // Verificar se o status é "open" antes de prosseguir com a requisição POST
            if (instanceData.status === 'open') {
              // Continuar com a requisição POST
              try {


                // Converta o número para uma string
                let telefoneString = item.telephone.toString();

                // Variável que armazenará o número de telefone modificado
                let numeroTelefone;

                // Expressão regular para verificar se o número começa com "55" ou "+55"
                const regex = /^(55|\+55)/;

                // Verifica se o número atende às condições especificadas
                if (regex.test(telefoneString)) {
                  // Remove o sexto dígito se o terceiro for 0 e o sexto for 9
                  if (telefoneString[2] === '0' && telefoneString[5] === '9') {
                    numeroTelefone = telefoneString.slice(0, 5) + telefoneString.slice(6);
                  }
                  // Remove o quinto dígito se o terceiro não for 0 e o quinto for 9
                  else if (telefoneString[2] !== '0' && telefoneString[4] === '9') {
                    numeroTelefone = telefoneString.slice(0, 4) + telefoneString.slice(5);
                  }
                  // Caso contrário, mantenha o número de telefone original
                  else {
                    numeroTelefone = telefoneString;
                  }
                } else {
                  // Se o número não começar com "55" ou "+55", atribua o número de telefone original
                  numeroTelefone = telefoneString;
                }

                // Exibe o número de telefone modificado
                console.log(numeroTelefone);


                var typebotUrl = typebot.split("/")[2];
                var typebotBot = typebot.split("/")[3];

                // Requisição Axios POST
                const response = await axios.post(`${evolutionUrl}/typebot/start/${line}`, {
                  url: `https://${typebotUrl}`,
                  typebot: typebotBot,
                  expire: 1,
                  remoteJid: `${numeroTelefone}@s.whatsapp.net`,
                  startSession: true,
                  variables: []
                },
                  {
                    headers: {
                      'Content-Type': 'application/json',
                      'apikey': evolutionKey
                    }
                  });

                console.log('Resposta da requisição:', response.data);
                res.status(200).json(response.data);

              } catch (error) {
                console.error('Erro na requisição POST:', error.response.data);

                // Adicionar lógica de tratamento de erro para a requisição POST

                if (error.response.data.response.message === 'Connection Closed') {
                  // Verificar se counter_erros é maior que 3 e atualizar o status para "Desativado"
                  if (counter_erros > 3) {
                    // Atualizar o status para "Desativado" dentro de triggerForList
                    const updatedUserProfile = {
                      ...userData.user_profile,
                      triggerForList: {
                        ...userData.user_profile.triggerForList,
                        status: 'Desativado'
                      }
                    };

                    // Atualizar o registro no banco de dados
                    supabase
                      .from('dp-v2-users')
                      .update({ user_profile: updatedUserProfile })
                      .eq('id', item.user_id)
                      .then(() => {
                        console.log(`Status do triggerForList atualizado para "Desativado" para o user_id: ${item.user_id}`);
                      })
                      .catch(updateError => {
                        console.error('Erro ao atualizar o status do triggerForList:', updateError);
                        res.status(500).json('Fatal Error');
                      });
                  }

                  res.status(400).json('Connection Closed');

                } else {
                  res.status(500).json('Error Desconhecido');
                }
              }
            } else {
              console.log(`A instância ${line} não está no status 'open'. Pulando para a próxima instância.`);
              // Adicionar lógica para lidar com instâncias que não estão no status 'open'

              // Pode adicionar lógica de tratamento de erro ou tomar outras ações necessárias

              res.status(400).json('Instância não está no status "open"');
            }
          } catch (error) {
            console.error('Erro na requisição GET da instância:', error.response.data);

            // Adicionar lógica de tratamento de erro para a requisição GET

            res.status(500).json('Error Desconhecido');
          }
        }

        // Dentro do seu loop ou onde apropriado
        else {
          let primaryLine;

          if (lastLine !== null) {
            primaryLine = line.find(item => item.instance === lastLine).instance;
          } else {
            primaryLine = line[0].instance;
          }

          // Inicializar uma variável para controlar se a requisição foi bem-sucedida
          let requestSuccessful = false;
          let allInstancesFailed = false;
          const failedInstances = new Set();

          while (!requestSuccessful && !allInstancesFailed) {
            // Encontrar a próxima instância após lastLine ou a primeira se lastLine for null ou o último
            const nextInstanceIndex = (lastLine !== null) ? (line.findIndex(item => item.instance === lastLine) + 1) % line.length : 0;
            const nextInstance = line[nextInstanceIndex];

            // Atualizar lastLine para a próxima instância
            lastLine = nextInstance.instance;

            // Fazer a requisição GET para verificar o status da instância
            try {
              const instanceResponse = await axios.get(`${evolutionUrl}/instance/fetchInstances?instanceName=${lastLine}`, {
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': evolutionKey
                }
              });

              const instanceData = instanceResponse.data.instance;

              // Verificar se o status é "open" antes de prosseguir com a requisição POST
              if (instanceData.status === 'open') {
                // Continuar com a requisição POST
                try {


                  // Converta o número para uma string
                  let telefoneString = item.telephone.toString();

                  // Variável que armazenará o número de telefone modificado
                  let numeroTelefone;

                  // Expressão regular para verificar se o número começa com "55" ou "+55"
                  const regex = /^(55|\+55)/;

                  // Verifica se o número atende às condições especificadas
                  if (regex.test(telefoneString)) {
                    // Remove o sexto dígito se o terceiro for 0 e o sexto for 9
                    if (telefoneString[2] === '0' && telefoneString[5] === '9') {
                      numeroTelefone = telefoneString.slice(0, 5) + telefoneString.slice(6);
                    }
                    // Remove o quinto dígito se o terceiro não for 0 e o quinto for 9
                    else if (telefoneString[2] !== '0' && telefoneString[4] === '9') {
                      numeroTelefone = telefoneString.slice(0, 4) + telefoneString.slice(5);
                    }
                    // Caso contrário, mantenha o número de telefone original
                    else {
                      numeroTelefone = telefoneString;
                    }
                  } else {
                    // Se o número não começar com "55" ou "+55", atribua o número de telefone original
                    numeroTelefone = telefoneString;
                  }

                  // Exibe o número de telefone modificado
                  console.log(numeroTelefone);

                  var typebotUrl = typebot.split("/")[2];
                  var typebotBot = typebot.split("/")[3];

                  // Realizar a requisição Axios
                  const response = await axios.post(`${evolutionUrl}/typebot/start/${lastLine}`, {
                    url: `https://${typebotUrl}`,
                    typebot: typebotBot,
                    expire: 1,
                    remoteJid: `${numeroTelefone}@s.whatsapp.net`,
                    startSession: true,
                    variables: []
                  },
                    {
                      headers: {
                        'Content-Type': 'application/json',
                        'apikey': evolutionKey
                      }
                    });

                  console.log('Resposta da requisição:', response.data);
                  // Definir a variável como true para sair do loop
                  requestSuccessful = true;


                  const { data: updateData, error: updateError } = await supabase
                    .from('dp-v2-users')
                    .update({ last_line: lastLine })
                    .eq('id', userData.id);

                  if (updateError) {
                    throw updateError;
                  }


                  res.status(200).json(response.data);

                } catch (error) {
                  console.error('Erro na requisição POST:', error.response.data);

                  // Adicionar a instância atual ao conjunto de instâncias que falharam
                  failedInstances.add(lastLine);

                  // Verificar se todas as instâncias foram percorridas sem sucesso
                  if (failedInstances.size === line.length) {
                    allInstancesFailed = true;
                  }
                }
              } else {
                console.log(`A instância ${lastLine} não está no status 'open'. Pulando para a próxima instância.`);
                // Adicionar a instância atual ao conjunto de instâncias que falharam
                failedInstances.add(lastLine);

                // Verificar se todas as instâncias foram percorridas sem sucesso
                if (failedInstances.size === line.length) {
                  allInstancesFailed = true;
                }
              }

            } catch (error) {
              console.error('Erro na requisição GET da instância:', error.response.data);

              // Adicionar a instância atual ao conjunto de instâncias que falharam
              failedInstances.add(lastLine);

              // Verificar se todas as instâncias foram percorridas sem sucesso
              if (failedInstances.size === line.length) {
                allInstancesFailed = true;
              }
            }
          }
          if (allInstancesFailed) {
            console.error('Todas as instâncias foram percorridas e todas falharam');
            // Adicione lógica para retornar código 500 com a mensagem desejada

            if (counter_erros > 2) {
              // Atualizar o status para "Desativado" dentro de triggerForList
              const updatedUserProfile = {
                ...userData.user_profile,
                triggerForList: {
                  ...userData.user_profile.triggerForList,
                  status: 'Desativado'
                }
              };

              // Atualizar o registro no banco de dados
              supabase
                .from('dp-v2-users')
                .update({ user_profile: updatedUserProfile })
                .eq('id', item.user_id)
                .then(() => {
                  console.log(`Status do triggerForList atualizado para "Desativado" para o user_id: ${item.user_id}`);
                })
                .catch(updateError => {
                  console.error('Erro ao atualizar o status do triggerForList:', updateError);
                  res.status(500).json('Fatal Error');
                });
            }
            res.status(400).json("Todas falharam");
          }
        }
      }
    }
    else {
      console.log('Nenhum usuário encontrado para o user_id:', item.user_id);
    }

    //res.status(200).json("OK");

  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});


app.listen(port, () => {
  console.log(`Servidor db rodando na porta ${port}`);
});


